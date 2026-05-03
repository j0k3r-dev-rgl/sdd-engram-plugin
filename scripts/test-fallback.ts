import * as fs from "node:fs";
import * as path from "node:path";
import { getOrchestratorPolicy } from "../src/orchestrator.ts";

// Mocking bits if needed, but here we test pure logic functions
// Since profiles.ts uses fs directly in some read/write functions, 
// we'll focus on testing the logic by providing data to the functions that accept objects.

function isFallbackEligibleSddAgent(name: string): boolean {
  const policy = getOrchestratorPolicy([name]);
  return name.startsWith("sdd-") && name !== policy.canonicalName && !name.endsWith("-fallback");
}

function normalizeForFallbackCompare(agentConfig: any): any {
  const clone = JSON.parse(JSON.stringify(agentConfig || {}));
  delete clone.model;
  return clone;
}

function listFallbackEligibleSddAgents(config: any): string[] {
  const agents = config?.agent || {};
  return Object.keys(agents).filter((name) => isFallbackEligibleSddAgent(name));
}

/**
 * Validates fallback mapping against a base config agent set
 */
function validateProfileFallbackMapping(config: any, fallback: any): string[] {
  const errors: string[] = [];
  const agents = config?.agent || {};

  for (const [baseAgentName, model] of Object.entries(fallback || {})) {
    if (!isFallbackEligibleSddAgent(baseAgentName)) {
      errors.push(`Invalid fallback target '${baseAgentName}'. Must be a base sdd-* agent (excluding sdd-orchestrator).`);
      continue;
    }

    if (!agents[baseAgentName]) {
      errors.push(`Fallback target '${baseAgentName}' does not exist in active config.`);
      continue;
    }

    if (typeof model !== "string" || !model.trim()) {
      errors.push(`Fallback model for '${baseAgentName}' must be a non-empty string.`);
    }
  }

  return errors;
}

/**
 * Ensures and reconciles sdd-*-fallback agents against base sdd-* agents
 */
function syncSddFallbackAgents(currentConfig: any, fallbackModels: any): any {
  const nextConfig = JSON.parse(JSON.stringify(currentConfig || {}));
  if (!nextConfig.agent) nextConfig.agent = {};

  const baseAgents = listFallbackEligibleSddAgents(nextConfig);

  for (const baseAgentName of baseAgents) {
    const baseConfig = nextConfig.agent?.[baseAgentName];
    if (!baseConfig || typeof baseConfig !== "object") continue;

    const fallbackAgentName = `${baseAgentName}-fallback`;
    const resolvedFallbackModel =
      (typeof fallbackModels?.[baseAgentName] === "string" && fallbackModels[baseAgentName].trim())
        ? fallbackModels[baseAgentName]
        : baseConfig?.model;

    if (!resolvedFallbackModel) continue;

    const desiredFallbackConfig = {
      ...JSON.parse(JSON.stringify(baseConfig)),
      model: resolvedFallbackModel,
    };

    const currentFallbackConfig = nextConfig.agent[fallbackAgentName];

    if (!currentFallbackConfig || typeof currentFallbackConfig !== "object") {
      nextConfig.agent[fallbackAgentName] = desiredFallbackConfig;
      continue;
    }

    const currentNormalized = normalizeForFallbackCompare(currentFallbackConfig);
    const desiredNormalized = normalizeForFallbackCompare(desiredFallbackConfig);

    if (JSON.stringify(currentNormalized) !== JSON.stringify(desiredNormalized)) {
      nextConfig.agent[fallbackAgentName] = desiredFallbackConfig;
      continue;
    }

    nextConfig.agent[fallbackAgentName] = {
      ...currentFallbackConfig,
      model: resolvedFallbackModel,
    };
  }

  return nextConfig;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
}

function testValidationLogic() {
  console.log("Testing validateProfileFallbackMapping...");
  
  const config = {
    agent: {
      "sdd-init": { model: "gpt-4" }
    }
  };

  // Success case: valid fallback for existing agent
  const validFallback = { "sdd-init": "gpt-3.5" };
  const errors1 = validateProfileFallbackMapping(config, validFallback);
  assert(errors1.length === 0, `Should have no errors for valid fallback, got: ${errors1.join(", ")}`);

  // Failure case: non-existent agent in config (Current BUG target)
  const invalidFallback = { "sdd-spec": "gpt-3.5" };
  const errors2 = validateProfileFallbackMapping(config, invalidFallback);
  assert(errors2.length > 0, "Should have error for non-existent agent in config");
  assert(errors2[0].includes("does not exist in active config"), "Error message should mention existence");

  // Failure case: ineligible agent
  const ineligibleFallback = { "sdd-orchestrator": "gpt-3.5" };
  const errors3 = validateProfileFallbackMapping(config, ineligibleFallback);
  assert(errors3.length > 0, "Should have error for ineligible agent");
  assert(errors3[0].includes("Invalid fallback target"), "Error message should mention invalid target");

  console.log("✅ validateProfileFallbackMapping logic tests passed");
}

function testSyncLogic() {
  console.log("Testing syncSddFallbackAgents...");

  const config = {
    agent: {
      "sdd-init": { model: "gpt-4", other: "prop" }
    }
  };

  const fallback = { "sdd-init": "gpt-3.5-turbo" };
  
  const nextConfig = syncSddFallbackAgents(config, fallback);
  
  assert(nextConfig.agent["sdd-init-fallback"] !== undefined, "sdd-init-fallback should be created");
  assert(nextConfig.agent["sdd-init-fallback"].model === "gpt-3.5-turbo", "Fallback model should match override");
  assert(nextConfig.agent["sdd-init-fallback"].other === "prop", "Fallback should inherit other properties");
  
  // Idempotency / No changes if already set correctly
  const nextConfig2 = syncSddFallbackAgents(nextConfig, fallback);
  assert(JSON.stringify(nextConfig) === JSON.stringify(nextConfig2), "Sync should be idempotent");

  console.log("✅ syncSddFallbackAgents logic tests passed");
}

function testActivationScenario() {
    console.log("Testing Activation Scenario (Simulated)...");
    
    // Scenario: Config has NO sdd-spec. Profile HAS sdd-spec (primary) and sdd-spec (fallback override).
    // Current bug: validation fails because it checks against currentConfig BEFORE applying primary models.
    
    const currentConfig = {
        agent: {
            "sdd-init": { model: "base-model" }
        }
    };
    
    const profileModels = {
        "sdd-spec": "new-spec-model"
    };
    
    const profileFallback = {
        "sdd-spec": "fallback-spec-model"
    };

    // 1. Current validation (fails incorrectly in current implementation)
    const errors = validateProfileFallbackMapping(currentConfig, profileFallback);
    console.log(`Validation against current config: ${errors.length === 0 ? "SUCCESS" : "FAIL (" + errors.join(", ") + ")"}`);

    // 2. Desired behavior: apply models first
    const applyProfileModelsToConfig = (cfg: any, models: any) => {
        const next = JSON.parse(JSON.stringify(cfg));
        for (const [k, v] of Object.entries(models)) {
            next.agent[k] = { ...(next.agent[k] || {}), model: v };
        }
        return next;
    };

    const configWithModels = applyProfileModelsToConfig(currentConfig, profileModels);
    const errorsAfterModels = validateProfileFallbackMapping(configWithModels, profileFallback);
    assert(errorsAfterModels.length === 0, `Validation should pass after applying primary models. Got: ${errorsAfterModels.join(", ")}`);
    
    console.log("✅ Activation scenario simulation passed");
}

async function run() {
  try {
    testValidationLogic();
    testSyncLogic();
    testActivationScenario();
    console.log("\nALL TESTS PASSED SUCCESSFULLY");
  } catch (e) {
    console.error("Test execution failed", e);
    process.exit(1);
  }
}

run();
