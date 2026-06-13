/** @jsxImportSource @opentui/solid */
import type { ProfileData, ProfileConfigs } from "./types";
import { isPrimarySddAgent, isSddFallbackAgent } from "./utils";
import {
  LEGACY_ORCHESTRATOR,
  UPDATED_ORCHESTRATOR,
  canonicalizeProfileModels,
  getOrchestratorPolicy,
  type OrchestratorPolicy,
} from "./orchestrator";

const KNOWN_EFFORT_TOKENS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

type ModelVariantOption = {
  key: string;
  effort: string;
};

function resolveModelDefinition(providers: any[], modelId: string): any | null {
  if (!modelId || typeof modelId !== "string") return null;
  const [providerId, ...rest] = modelId.split("/");
  const modelKey = rest.join("/");
  if (!providerId || !modelKey) return null;
  const provider = (providers || []).find((p: any) => p?.id === providerId);
  return provider?.models?.[modelKey] || null;
}

function extractEffortFromVariantBody(variant: any, variantKey: string): string | null {
  if (!variant || typeof variant !== "object" || variant.disabled === true) return null;

  if (typeof variant.reasoningEffort === "string") {
    const trimmed = variant.reasoningEffort.trim();
    if (trimmed) return trimmed;
  }

  if (typeof variant.reasoning?.effort === "string") {
    const trimmed = variant.reasoning.effort.trim();
    if (trimmed) return trimmed;
  }

  if (typeof variant.thinkingConfig?.thinkingLevel === "string") {
    const trimmed = variant.thinkingConfig.thinkingLevel.trim();
    if (trimmed) return trimmed;
  }

  const normalizedKey = variantKey.trim().toLowerCase();
  if (KNOWN_EFFORT_TOKENS.has(normalizedKey)) return normalizedKey;

  return null;
}

function listModelVariantOptions(modelDef: any): ModelVariantOption[] {
  if (!modelDef || modelDef?.capabilities?.reasoning !== true) return [];
  const variants = modelDef?.variants;
  if (!variants || typeof variants !== "object") return [];

  const options: ModelVariantOption[] = [];
  for (const [key, variant] of Object.entries(variants)) {
    const effort = extractEffortFromVariantBody(variant, key);
    if (effort) options.push({ key, effort });
  }
  return options;
}

function listReasoningEffortsFromModel(modelDef: any): string[] {
  const values = listModelVariantOptions(modelDef).map((option) => option.effort);
  return Array.from(new Set(values)).sort();
}

function resolveVariantKeyForEffort(modelDef: any, effort: string): string | null {
  const matches = listModelVariantOptions(modelDef).filter((option) => option.effort === effort);
  if (matches.length === 0) return null;

  const keyMatch = matches.find((option) => option.key.toLowerCase() === effort.toLowerCase());
  return (keyMatch || matches[0]).key;
}

export function resolveEffortFromAgentVariant(providers: any[], modelId: string, variantKey?: string): string | undefined {
  if (typeof variantKey !== "string" || !variantKey.trim()) return undefined;
  const modelDef = resolveModelDefinition(providers, modelId);
  if (!modelDef) return undefined;

  const option = listModelVariantOptions(modelDef).find((entry) => entry.key === variantKey.trim());
  return option?.effort;
}

export function buildReasoningEditState(
  providers: any[],
  agentName: string,
  modelId?: string,
  current?: string,
): any {
  if (!modelId) return { kind: "missing-model", agentName };
  const modelDef = resolveModelDefinition(providers, modelId);
  const options = listReasoningEffortsFromModel(modelDef);
  if (options.length === 0) {
    return { kind: "unsupported", agentName, modelId };
  }
  return {
    kind: "selectable",
    agentName,
    modelId,
    options,
    ...(typeof current === "string" && current.trim() ? { current: current.trim() } : {}),
  };
}

function canonicalizeProfileConfigs(configs: ProfileConfigs, policy: OrchestratorPolicy): ProfileConfigs {
  const next = { ...(configs || {}) };
  const canonicalEffort =
    next?.[policy.canonicalName]?.reasoningEffort ||
    next?.[LEGACY_ORCHESTRATOR]?.reasoningEffort ||
    next?.[UPDATED_ORCHESTRATOR]?.reasoningEffort;

  delete next[LEGACY_ORCHESTRATOR];
  delete next[UPDATED_ORCHESTRATOR];

  if (canonicalEffort) {
    next[policy.canonicalName] = {
      ...(next[policy.canonicalName] || {}),
      reasoningEffort: canonicalEffort,
    };
  }

  return next;
}

export function normalizeProfileConfigs(configs: unknown, policy?: OrchestratorPolicy): ProfileConfigs | undefined {
  if (!configs || typeof configs !== "object" || Array.isArray(configs)) return undefined;
  const normalizedBase = Object.fromEntries(
    Object.entries(configs as Record<string, any>)
      .filter(([agentName]) => isPrimarySddAgent(agentName) && !isSddFallbackAgent(agentName))
      .map(([agentName, config]) => {
        const effort = typeof config?.reasoningEffort === "string" ? config.reasoningEffort.trim() : "";
        return effort ? [agentName, { reasoningEffort: effort }] : null;
      })
      .filter(Boolean) as any,
  );

  const normalized = policy ? canonicalizeProfileConfigs(normalizedBase, policy) : normalizedBase;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function updateProfileReasoningEffort(profile: ProfileData, agentName: string, value?: string): ProfileData {
  if (!isPrimarySddAgent(agentName) || isSddFallbackAgent(agentName)) {
    return profile;
  }

  const nextConfigs: Record<string, any> = { ...(profile?.configs || {}) };
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    delete nextConfigs[agentName];
  } else {
    nextConfigs[agentName] = {
      ...(nextConfigs[agentName] || {}),
      reasoningEffort: trimmed,
    };
  }

  const normalized = normalizeProfileConfigs(nextConfigs);
  const nextProfile: any = {
    ...(profile || { models: {} }),
  };
  delete nextProfile.configs;
  if (normalized) nextProfile.configs = normalized;
  return nextProfile;
}

function clearAgentReasoningEffort(agentConfig: any) {
  if (!agentConfig || typeof agentConfig !== "object") return;
  delete agentConfig.variant;
  delete agentConfig.reasoningEffort;
  if (agentConfig.options && typeof agentConfig.options === "object") {
    delete agentConfig.options.reasoningEffort;
  }
}

function applyAgentReasoningEffort(agentConfig: any, variantKey: string) {
  const next = {
    ...(agentConfig || {}),
    variant: variantKey,
  };
  delete next.reasoningEffort;
  if (next.options && typeof next.options === "object") {
    const { reasoningEffort: _removed, ...restOptions } = next.options;
    next.options = restOptions;
  }
  return next;
}

export function applyProfileReasoningEffort(currentConfig: any, profile: ProfileData, providers: any[], policy?: OrchestratorPolicy): {
  config: any;
  warnings: string[];
  appliedAgents: string[];
  clearedAgents: string[];
} {
  const nextConfig = JSON.parse(JSON.stringify(currentConfig || {}));
  const warnings: string[] = [];
  const appliedAgents: string[] = [];
  const clearedAgents: string[] = [];
  const effectivePolicy = policy || getOrchestratorPolicy(
    [
      ...Object.keys(nextConfig?.agent || {}),
      ...Object.keys(profile?.models || {}),
      ...Object.keys(profile?.configs || {}),
    ],
    nextConfig?.default_agent,
  );
  const normalizedConfigs = normalizeProfileConfigs(profile?.configs, effectivePolicy);

  const scopedPrimaryAgents = Object.keys(
    canonicalizeProfileModels(profile?.models || {}, effectivePolicy)
  ).filter((agentName) => isPrimarySddAgent(agentName) && !isSddFallbackAgent(agentName));

  const configuredAgents = new Set(Object.keys(normalizedConfigs || {}));
  for (const agentName of scopedPrimaryAgents) {
    if (configuredAgents.has(agentName)) continue;
    if (nextConfig?.agent?.[agentName] && typeof nextConfig.agent[agentName] === "object") {
      clearAgentReasoningEffort(nextConfig.agent[agentName]);
      clearedAgents.push(agentName);
    }
  }

  if (!normalizedConfigs) {
    return { config: nextConfig, warnings, appliedAgents, clearedAgents };
  }

  for (const [agentName, cfg] of Object.entries(normalizedConfigs)) {
    if (!isPrimarySddAgent(agentName) || isSddFallbackAgent(agentName)) continue;
    const effort = cfg?.reasoningEffort;
    if (!effort) continue;
    const modelId = nextConfig?.agent?.[agentName]?.model;
    if (!modelId) continue;

    const modelDef = resolveModelDefinition(providers, modelId);
    const options = listReasoningEffortsFromModel(modelDef);
    if (!modelDef || options.length === 0) {
      if (nextConfig?.agent?.[agentName] && typeof nextConfig.agent[agentName] === "object") {
        clearAgentReasoningEffort(nextConfig.agent[agentName]);
        clearedAgents.push(agentName);
      }
      warnings.push(`Skipped reasoning effort for ${agentName}: missing runtime metadata for ${modelId}.`);
      continue;
    }
    if (!options.includes(effort)) {
      if (nextConfig?.agent?.[agentName] && typeof nextConfig.agent[agentName] === "object") {
        clearAgentReasoningEffort(nextConfig.agent[agentName]);
        clearedAgents.push(agentName);
      }
      warnings.push(`Skipped reasoning effort for ${agentName}: saved value '${effort}' is incompatible with ${modelId}.`);
      continue;
    }

    const variantKey = resolveVariantKeyForEffort(modelDef, effort);
    if (!variantKey) {
      if (nextConfig?.agent?.[agentName] && typeof nextConfig.agent[agentName] === "object") {
        clearAgentReasoningEffort(nextConfig.agent[agentName]);
        clearedAgents.push(agentName);
      }
      warnings.push(`Skipped reasoning effort for ${agentName}: no variant key resolved for '${effort}' on ${modelId}.`);
      continue;
    }

    if (!nextConfig.agent) nextConfig.agent = {};
    nextConfig.agent[agentName] = applyAgentReasoningEffort(nextConfig.agent[agentName], variantKey);
    appliedAgents.push(agentName);
  }

  return { config: nextConfig, warnings, appliedAgents, clearedAgents: Array.from(new Set(clearedAgents)) };
}
