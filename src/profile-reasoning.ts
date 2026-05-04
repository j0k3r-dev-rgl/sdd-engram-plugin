/** @jsxImportSource @opentui/solid */
// @ts-nocheck

import type { ProfileData, ProfileConfigs } from "./types";
import { isPrimarySddAgent, isSddFallbackAgent } from "./utils";

function resolveModelDefinition(providers: any[], modelId: string): any | null {
  if (!modelId || typeof modelId !== "string") return null;
  const [providerId, ...rest] = modelId.split("/");
  const modelKey = rest.join("/");
  if (!providerId || !modelKey) return null;
  const provider = (providers || []).find((p: any) => p?.id === providerId);
  return provider?.models?.[modelKey] || null;
}

function listReasoningEffortsFromModel(modelDef: any): string[] {
  if (!modelDef || modelDef?.capabilities?.reasoning !== true) return [];
  const variants = modelDef?.variants;
  if (!variants || typeof variants !== "object") return [];
  const values = Object.values(variants)
    .map((variant: any) => (typeof variant?.reasoningEffort === "string" ? variant.reasoningEffort.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(values)).sort();
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

export function normalizeProfileConfigs(configs: unknown): ProfileConfigs | undefined {
  if (!configs || typeof configs !== "object" || Array.isArray(configs)) return undefined;
  const normalized = Object.fromEntries(
    Object.entries(configs as Record<string, any>)
      .filter(([agentName]) => isPrimarySddAgent(agentName) && !isSddFallbackAgent(agentName))
      .map(([agentName, config]) => {
        const effort = typeof config?.reasoningEffort === "string" ? config.reasoningEffort.trim() : "";
        return effort ? [agentName, { reasoningEffort: effort }] : null;
      })
      .filter(Boolean) as any,
  );

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

export function applyProfileReasoningEffort(currentConfig: any, profile: ProfileData, providers: any[]): {
  config: any;
  warnings: string[];
  appliedAgents: string[];
} {
  const nextConfig = JSON.parse(JSON.stringify(currentConfig || {}));
  const warnings: string[] = [];
  const appliedAgents: string[] = [];
  const normalizedConfigs = normalizeProfileConfigs(profile?.configs);
  if (!normalizedConfigs) {
    return { config: nextConfig, warnings, appliedAgents };
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
      warnings.push(`Skipped reasoning effort for ${agentName}: missing runtime metadata for ${modelId}.`);
      continue;
    }
    if (!options.includes(effort)) {
      warnings.push(`Skipped reasoning effort for ${agentName}: saved value '${effort}' is incompatible with ${modelId}.`);
      continue;
    }

    if (!nextConfig.agent) nextConfig.agent = {};
    nextConfig.agent[agentName] = {
      ...(nextConfig.agent[agentName] || {}),
      reasoningEffort: effort,
    };
    appliedAgents.push(agentName);
  }

  return { config: nextConfig, warnings, appliedAgents };
}
