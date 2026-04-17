/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * SDD Profiles Logic
 *
 * Handles reading, writing, and activating profile configurations,
 * focusing on SDD agents and their associated models.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ProfileData, ProfileFallbackModels, ProfileModels } from "./types";
import {
  isManagedSddAgent,
  isFallbackEligibleSddAgent,
  isPrimarySddAgent,
  isSddFallbackAgent,
} from "./utils";
import { resolvePaths, ensureProfilesDir } from "./config";

/**
 * Checks if a file name represents a valid SDD profile
 *
 * @param fileName - The file name to check
 * @returns True if the file has a .json extension
 */
export function isSddProfile(fileName: string): boolean {
  return fileName.endsWith(".json");
}

/**
 * Extracts models specifically for managed SDD base agents from a configuration object
 *
 * @param config - The raw configuration object
 * @returns Mapping of SDD agent names to their model IDs
 */
export function extractSddAgentModels(config: any): ProfileModels {
  const agents = config?.agent || {};
  return Object.fromEntries(
    Object.entries(agents)
      .filter(
        ([name, value]: any) =>
          isPrimarySddAgent(name) &&
          !isSddFallbackAgent(name) &&
          typeof value?.model === "string" &&
          value.model
      )
      .map(([name, value]: any) => [name, value.model])
  );
}

/**
 * Extracts SDD fallback model mapping from a profile payload
 */
export function extractSddFallbackModels(raw: any): ProfileFallbackModels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const source = raw.fallback && typeof raw.fallback === "object" && !Array.isArray(raw.fallback)
    ? raw.fallback
    : {};

  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]: any) => isFallbackEligibleSddAgent(name) && typeof value === "string" && value.trim()
    )
  );
}

/**
 * Reads and parses SDD agent models from a profile file.
 * Supports full config objects, legacy flat maps, and the new profile payload shape.
 *
 * @param profilePath - Absolute path to the profile file
 * @returns Mapping of SDD agent names to their model IDs
 */
export function readProfileModels(profilePath: string): ProfileModels {
  const raw = JSON.parse(fs.readFileSync(profilePath, "utf-8"));

  // New profile format: { models: { ... }, fallback: { ... } }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.models && typeof raw.models === "object") {
    return Object.fromEntries(
      Object.entries(raw.models)
        .filter(([name, value]: any) => isPrimarySddAgent(name) && typeof value === "string" && value.trim())
        .map(([name, value]: any) => [name, value])
    );
  }

  // Legacy profile format: { "sdd-init": "provider/model", ... }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && !raw.agent && !raw.models) {
    return Object.fromEntries(
      Object.entries(raw)
        .filter(
          ([name, value]: any) =>
            isPrimarySddAgent(name) &&
            ((typeof value === "string" && value) || (typeof value?.model === "string" && value.model))
        )
        .map(([name, value]: any) => [name, typeof value === "string" ? value : value.model])
    );
  }

  // Config format: { agent: { ... } }
  return extractSddAgentModels(raw);
}

/**
 * Reads fallback model overrides from a profile file
 */
export function readProfileFallbackModels(profilePath: string): ProfileFallbackModels {
  try {
    const raw = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    return extractSddFallbackModels(raw);
  } catch {
    return {};
  }
}

/**
 * Reads full profile data from file (models + fallback)
 */
export function readProfileData(profilePath: string): ProfileData {
  return {
    models: readProfileModels(profilePath),
    fallback: readProfileFallbackModels(profilePath),
  };
}

/**
 * Persists SDD agent model mappings to a profile file,
 * preserving fallback mappings if present.
 *
 * @param profilePath - Absolute path where the profile will be saved
 * @param models - Mapping of SDD agent names to their model IDs
 */
export function writeProfileModels(profilePath: string, models: ProfileModels): void {
  const fallback = readProfileFallbackModels(profilePath);
  const payload: ProfileData = {
    models,
    ...(Object.keys(fallback).length > 0 ? { fallback } : {}),
  };
  fs.writeFileSync(profilePath, JSON.stringify(payload, null, 2));
}

/**
 * Writes fallback model overrides while preserving primary models
 */
export function writeProfileFallbackModels(profilePath: string, fallback: ProfileFallbackModels): void {
  const models = readProfileModels(profilePath);
  const payload: ProfileData = {
    models,
    ...(Object.keys(fallback).length > 0 ? { fallback } : {}),
  };
  fs.writeFileSync(profilePath, JSON.stringify(payload, null, 2));
}

/**
 * Identifies which profile file (if any) matches the currently active system configuration
 *
 * @param files - List of profile file names to check
 * @param api - The TUI API instance
 * @returns The matching profile file name or undefined
 */
export function detectActiveProfileFile(files: string[], api: any): string | undefined {
  const activeAgents = (api.state.config as any)?.agent || {};
  const { profilesDir } = resolvePaths();
  const activeSddAgents = Object.fromEntries(
    Object.entries(activeAgents)
      .filter(([name, value]: any) => isPrimarySddAgent(name) && typeof value?.model === "string" && value.model)
      .map(([name, value]: any) => [name, value.model])
  );

  for (const file of files) {
    try {
      const profileModels = readProfileModels(path.join(profilesDir, file));
      const keys = Object.keys(profileModels);
      if (keys.length === 0) continue;

      if (keys.length !== Object.keys(activeSddAgents).length) continue;

      const allMatch = keys.every((agentName) => {
        const profileModel = profileModels[agentName];
        const activeModel = activeSddAgents[agentName];
        return profileModel && profileModel === activeModel;
      });

      if (allMatch) return file;
    } catch (e) {}
  }
  return undefined;
}

/**
 * Returns fallback-eligible SDD base agents from config
 */
export function listFallbackEligibleSddAgents(config: any): string[] {
  const agents = config?.agent || {};
  return Object.keys(agents).filter((name) => isFallbackEligibleSddAgent(name));
}

/**
 * Validates fallback mapping against a base config agent set
 */
export function validateProfileFallbackMapping(config: any, fallback: ProfileFallbackModels): string[] {
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

function normalizeForFallbackCompare(agentConfig: any): any {
  const clone = JSON.parse(JSON.stringify(agentConfig || {}));
  delete clone.model;
  return clone;
}

/**
 * Ensures and reconciles sdd-*-fallback agents against base sdd-* agents
 */
export function syncSddFallbackAgents(currentConfig: any, fallbackModels: ProfileFallbackModels): any {
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

/**
 * Merges profile models into a configuration object
 *
 * @param currentConfig - The base configuration object
 * @param profileModels - Mapping of models to apply
 * @returns Updated configuration object
 */
function applyProfileModelsToConfig(currentConfig: any, profileModels: ProfileModels): any {
  const nextConfig = JSON.parse(JSON.stringify(currentConfig || {}));
  if (!nextConfig.agent) nextConfig.agent = {};

  for (const [agentName, modelId] of Object.entries(profileModels)) {
    nextConfig.agent[agentName] = {
      ...(nextConfig.agent[agentName] || {}),
      model: modelId,
    };
  }

  return nextConfig;
}

/**
 * Applies full profile data to config (primary models + fallback reconciliation)
 */
function applyProfileDataToConfig(currentConfig: any, profile: ProfileData): any {
  const withPrimaryModels = applyProfileModelsToConfig(currentConfig, profile.models || {});
  const fallbackModels = profile.fallback || {};
  return syncSddFallbackAgents(withPrimaryModels, fallbackModels);
}

/**
 * Activates a specific profile by updating the global runtime configuration
 *
 * @param api - The TUI API instance
 * @param profilePath - Absolute path to the profile to activate
 * @param profileName - Display name of the profile
 * @returns The updated configuration or null if activation failed
 */
export async function activateProfileFile(api: any, profilePath: string, profileName: string): Promise<any | null> {
  const { configPath } = resolvePaths();
  try {
    const profileData = readProfileData(profilePath);
    const profileModels = profileData.models || {};

    if (Object.keys(profileModels).length === 0 && Object.keys(profileData.fallback || {}).length === 0) {
      api.ui.toast({
        title: "Activation Failed",
        message: "The profile contains no SDD models or fallbacks to apply",
        variant: "error",
      });
      return;
    }

    // IMPORTANT:
    // Use on-disk config as source-of-truth to preserve declarative links like
    // {file:...}. Runtime `global.config.get()` may return resolved content,
    // and sending that back can materialize/inline file contents.
    let currentConfig: any;
    if (fs.existsSync(configPath)) {
      currentConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } else {
      const globalConfigResult = await api.client.global.config.get();
      currentConfig = globalConfigResult?.data || {};
    }

    const nextConfigWithModels = applyProfileModelsToConfig(currentConfig, profileData.models || {});
    const fallbackValidationErrors = validateProfileFallbackMapping(nextConfigWithModels, profileData.fallback || {});
    if (fallbackValidationErrors.length > 0) {
      throw new Error(fallbackValidationErrors.join(" | "));
    }

    const nextConfig = syncSddFallbackAgents(nextConfigWithModels, profileData.fallback || {});

    const result = await api.client.global.config.update({
      config: nextConfig,
    });

    if (result?.error) throw new Error(result.error.message || "Failed to update global runtime configuration");

    // IMPORTANT:
    // Do NOT rewrite opencode.json from plugin-side after profile switch.
    // The runtime config API is the source of truth for persistence/format.
    // Rewriting here causes full-file churn (indent/style drift) and can
    // materialize resolved/default fields that were not explicitly set.
    return result?.data || nextConfig;
  } catch (err: any) {
    api.ui.toast({ title: "Activation Failed", message: err.message, variant: "error" });
    return null;
  }
}

/**
 * Lists all available profile files in the profiles directory
 *
 * @returns Array of profile file names
 */
export function listProfileFiles(): string[] {
  const { profilesDir } = resolvePaths();
  ensureProfilesDir();
  try {
    return fs.readdirSync(profilesDir).filter((f) => isSddProfile(f));
  } catch {
    return [];
  }
}

/**
 * Deletes a profile file from disk
 *
 * @param fileName - Name of the file to delete
 */
export function deleteProfileFile(fileName: string): void {
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, fileName);
  fs.unlinkSync(profilePath);
}

/**
 * Renames an existing profile file
 *
 * @param oldFileName - Original file name
 * @param newFileName - New file name
 */
export function renameProfileFile(oldFileName: string, newFileName: string): void {
  const { profilesDir } = resolvePaths();
  const oldPath = path.join(profilesDir, oldFileName);
  const newPath = path.join(profilesDir, newFileName);
  fs.renameSync(oldPath, newPath);
}
