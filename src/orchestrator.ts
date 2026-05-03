export const LEGACY_ORCHESTRATOR = "sdd-orchestrator" as const;
export const UPDATED_ORCHESTRATOR = "gentle-orchestrator" as const;

export type CanonicalOrchestratorName = typeof LEGACY_ORCHESTRATOR | typeof UPDATED_ORCHESTRATOR;

export type OrchestratorPolicy = {
  canonicalName: CanonicalOrchestratorName;
  aliasNames: CanonicalOrchestratorName[];
  migrationEnabled: boolean;
};

export function getOrchestratorPolicy(agentNames: string[], defaultAgent?: string): OrchestratorPolicy {
  const all = new Set([...(agentNames || []), defaultAgent || ""]);
  const hasUpdated = all.has(UPDATED_ORCHESTRATOR);
  const hasLegacy = all.has(LEGACY_ORCHESTRATOR);

  if (hasUpdated) {
    return { canonicalName: UPDATED_ORCHESTRATOR, aliasNames: [UPDATED_ORCHESTRATOR, LEGACY_ORCHESTRATOR], migrationEnabled: true };
  }

  if (hasLegacy) {
    return { canonicalName: LEGACY_ORCHESTRATOR, aliasNames: [LEGACY_ORCHESTRATOR, UPDATED_ORCHESTRATOR], migrationEnabled: false };
  }

  return { canonicalName: LEGACY_ORCHESTRATOR, aliasNames: [LEGACY_ORCHESTRATOR, UPDATED_ORCHESTRATOR], migrationEnabled: false };
}

export function resolveCanonicalOrchestratorModel(models: Record<string, string>, policy: OrchestratorPolicy): string | undefined {
  for (const name of policy.aliasNames) {
    const value = models?.[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function canonicalizeProfileModels(models: Record<string, string>, policy: OrchestratorPolicy): Record<string, string> {
  const next = { ...(models || {}) };
  const resolved = resolveCanonicalOrchestratorModel(next, policy);
  delete next[LEGACY_ORCHESTRATOR];
  delete next[UPDATED_ORCHESTRATOR];
  if (resolved) next[policy.canonicalName] = resolved;
  return next;
}

export function canonicalizeAgentConfig(agentConfig: Record<string, any>, policy: OrchestratorPolicy): Record<string, any> {
  const next = JSON.parse(JSON.stringify(agentConfig || {}));
  const canonicalModel = resolveCanonicalOrchestratorModel(
    Object.fromEntries(
      Object.entries(next).map(([name, value]: any) => [name, typeof value?.model === "string" ? value.model : ""])
    ),
    policy
  );

  delete next[LEGACY_ORCHESTRATOR];
  delete next[UPDATED_ORCHESTRATOR];

  if (canonicalModel) {
    next[policy.canonicalName] = {
      ...(next[policy.canonicalName] || {}),
      model: canonicalModel,
    };
  }

  return next;
}
