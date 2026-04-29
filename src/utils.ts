/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * General Plugin Utilities
 * 
 * Provides helper functions for text formatting, model information resolution,
 * and profile parsing.
 */

import { ActiveProfileState } from "./types";

/**
 * Formats a token count into a human-readable context string
 * 
 * @param tokens - Number of tokens to format
 * @returns Formatted context string (e.g., "128k ctx", "1M ctx")
 */
export function formatContext(tokens: number | null): string {
  if (!tokens || typeof tokens !== "number") return "ctx: N/A";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`;
  return `${tokens} ctx`;
}

/**
 * Formats a memory timestamp into a localized string
 * 
 * @param value - ISO date string or undefined
 * @returns Localized date string or "No date" fallback
 */
export function formatMemoryDate(value: string | undefined): string {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/**
 * Truncates text to a maximum length, adding an ellipsis if necessary
 * 
 * @param value - Text to truncate
 * @param max - Maximum allowed length (default: 120)
 * @returns Truncated string
 */
export function truncateText(value: string, max = 120): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Checks if an agent name follows the managed SDD naming convention
 * 
 * @param agentName - Name of the agent to check
 * @returns True if the agent name starts with "sdd-"
 */
export function isManagedSddAgent(agentName: string): boolean {
  return agentName.startsWith("sdd-");
}

/**
 * Checks if an agent is a generated fallback agent
 */
export function isSddFallbackAgent(agentName: string): boolean {
  return isManagedSddAgent(agentName) && agentName.endsWith("-fallback");
}

/**
 * Checks if an agent is a primary SDD agent (non-fallback)
 */
export function isPrimarySddAgent(agentName: string): boolean {
  return isManagedSddAgent(agentName) && !isSddFallbackAgent(agentName);
}

/**
 * Checks if an agent is eligible for fallback generation
 * (all sdd-* except orchestrator and existing fallbacks)
 */
export function isFallbackEligibleSddAgent(agentName: string): boolean {
  return isPrimarySddAgent(agentName) && agentName !== "sdd-orchestrator";
}

/**
 * Resolves full model information including provider and context limit
 * 
 * @param api - The TUI API instance
 * @param modelId - The unique model identifier
 * @returns Human-readable model information string
 */
export function resolveModelInfo(api: any, modelId: string): string {
  if (!modelId) return "Unassigned";
  const [providerId, ...rest] = modelId.split("/");
  const modelKey = rest.join("/");
  const provider = api.state.provider.find((p: any) => p.id === providerId);
  const model = provider?.models?.[modelKey];
  const ctx = model?.limit?.context;
  const ctxStr = ctx ? ` (${formatContext(ctx)})` : "";
  return `${modelId}${ctxStr}`;
}

function resolveModelState(api: any, providerId: string, modelKey: string): ActiveProfileState {
  const providers = api.state.provider || [];
  const provider = providers.find((p: any) => p.id === providerId);

  if (!provider) {
    return {
      modelId: `${providerId}/${modelKey}`,
      modelName: modelKey,
      providerName: providerId,
      contextLimit: null,
    };
  }

  const modelDef = provider.models?.[modelKey];
  return {
    modelId: `${providerId}/${modelKey}`,
    modelName: modelDef?.name || modelKey,
    providerName: provider.name || provider.id,
    contextLimit: modelDef?.limit?.context || null,
  };
}

function resolveAgentModelState(api: any, agentName?: string, fallbackModel?: { providerID: string; modelID: string }): ActiveProfileState | null {
  if (agentName) {
    const configuredModelId = api.state.config?.agent?.[agentName]?.model;
    if (typeof configuredModelId === "string" && configuredModelId) {
      const [providerId, ...rest] = configuredModelId.split("/");
      const modelKey = rest.join("/");
      return resolveModelState(api, providerId, modelKey);
    }
  }

  if (fallbackModel?.providerID && fallbackModel?.modelID) {
    return resolveModelState(api, fallbackModel.providerID, fallbackModel.modelID);
  }

  return null;
}

/**
 * Resolves the active model for a specific session from real session messages.
 * Priorities the agent from the last USER message (the orchestrator/entry point).
 */
export function resolveSessionActiveModel(api: any, sessionId?: string): ActiveProfileState | null {
  if (!sessionId) return null;

  const messages = api.state.session?.messages?.(sessionId) || [];
  
  // 1. Prioritize agent from the last USER message (the orchestrator/entry point)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.agent) {
      const resolved = resolveAgentModelState(api, message.agent, message.model);
      if (resolved) return resolved;
    }
  }

  // 2. If no user messages, try the last assistant message as a fallback
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      const resolved = resolveAgentModelState(api, message.agent, {
        providerID: message.providerID,
        modelID: message.modelID,
      });
      if (resolved) return resolved;
    }
  }

  // 3. If NO messages at all, use the default agent from config or orchestrator
  const defaultAgent = api.state.config?.default_agent || "sdd-orchestrator";
  return resolveAgentModelState(api, defaultAgent);
}

/**
 * Parses the active profile state from raw configuration text
 * 
 * @param raw - The raw JSON configuration string
 * @param api - The TUI API instance
 * @returns The parsed active profile state or null if invalid
 */
export function parseActiveProfileFromRaw(raw: string, api: any): ActiveProfileState | null {
  try {
    const config = JSON.parse(raw);
    const agentConfigs = config.agent || config.model || {};
    const agentNames = Object.keys(agentConfigs);

    if (agentNames.length === 0) return null;

    // Strategy: Find the orchestrator first, then any managed SDD agent, or fallback to the first available agent
    const firstAgent =
      agentNames.find((name) => name === "sdd-orchestrator" && agentConfigs[name]?.model) ||
      agentNames.find((name) => isManagedSddAgent(name) && agentConfigs[name]?.model) ||
      agentNames.find((name) => agentConfigs[name]?.model) ||
      agentNames[0];

    const modelId = agentConfigs[firstAgent]?.model;
    if (!modelId) return null;

    const [providerId, ...rest] = modelId.split("/");
    const modelKey = rest.join("/");
    return resolveModelState(api, providerId, modelKey);
  } catch {
    return null;
  }
}
