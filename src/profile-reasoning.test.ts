import { describe, expect, it } from "vitest";
import {
  applyProfileReasoningEffort,
  buildReasoningEditState,
  normalizeProfileConfigs,
  updateProfileReasoningEffort,
} from "./profile-reasoning";
import { getOrchestratorPolicy } from "./orchestrator";

describe("profile reasoning helpers", () => {
  describe("buildReasoningEditState", () => {
    const providers = [
      {
        id: "openai",
        models: {
          "gpt-5": {
            capabilities: { reasoning: true },
            variants: {
              default: { reasoningEffort: "low" },
              high: { reasoningEffort: "high" },
              duplicate: { reasoningEffort: "low" },
            },
          },
          "gpt-4.1": {
            capabilities: { reasoning: false },
            variants: {
              default: {},
            },
          },
        },
      },
    ];

    it("returns selectable with unique options when metadata supports reasoning", () => {
      const state = buildReasoningEditState(providers as any, "sdd-apply", "openai/gpt-5", "low");

      expect(state).toEqual({
        kind: "selectable",
        agentName: "sdd-apply",
        modelId: "openai/gpt-5",
        options: ["high", "low"],
        current: "low",
      });
    });

    it("returns missing-model when no model is assigned", () => {
      const state = buildReasoningEditState(providers as any, "sdd-apply", undefined, "low");
      expect(state).toEqual({ kind: "missing-model", agentName: "sdd-apply" });
    });

    it("returns unsupported when model disables reasoning or lacks effort variants", () => {
      const disabled = buildReasoningEditState(providers as any, "sdd-apply", "openai/gpt-4.1");
      expect(disabled).toEqual({ kind: "unsupported", agentName: "sdd-apply", modelId: "openai/gpt-4.1" });

      const noMetadata = buildReasoningEditState(providers as any, "sdd-apply", "openai/unknown");
      expect(noMetadata).toEqual({ kind: "unsupported", agentName: "sdd-apply", modelId: "openai/unknown" });
    });
  });

  describe("normalizeProfileConfigs", () => {
    it("keeps only primary agents with trimmed reasoning effort", () => {
      const normalized = normalizeProfileConfigs({
        "sdd-apply": { reasoningEffort: " high " },
        "sdd-apply-fallback": { reasoningEffort: "low" },
        "non-sdd": { reasoningEffort: "medium" },
        "sdd-init": { unknown: "x", reasoningEffort: "" },
      } as any);

      expect(normalized).toEqual({
        "sdd-apply": { reasoningEffort: "high" },
      });
    });

    it("returns undefined for empty or invalid config maps", () => {
      expect(normalizeProfileConfigs(undefined)).toBeUndefined();
      expect(normalizeProfileConfigs({ "sdd-apply": { reasoningEffort: "   " } } as any)).toBeUndefined();
    });

    it("canonicalizes orchestrator aliases to gentle-orchestrator in updated runtime policy", () => {
      const policy = getOrchestratorPolicy(["gentle-orchestrator", "sdd-init"]);
      const normalized = normalizeProfileConfigs({
        "sdd-orchestrator": { reasoningEffort: "high" },
      } as any, policy);

      expect(normalized).toEqual({
        "gentle-orchestrator": { reasoningEffort: "high" },
      });
    });

    it("canonicalizes orchestrator aliases to sdd-orchestrator in legacy runtime policy", () => {
      const policy = getOrchestratorPolicy(["sdd-orchestrator", "sdd-init"]);
      const normalized = normalizeProfileConfigs({
        "gentle-orchestrator": { reasoningEffort: "low" },
      } as any, policy);

      expect(normalized).toEqual({
        "sdd-orchestrator": { reasoningEffort: "low" },
      });
    });
  });

  describe("updateProfileReasoningEffort", () => {
    it("sets one primary agent reasoning effort without changing models/fallback", () => {
      const profile = {
        models: { "sdd-apply": "openai/gpt-5" },
        fallback: { "sdd-apply": "openai/gpt-4.1" },
      } as any;

      const updated = updateProfileReasoningEffort(profile, "sdd-apply", " medium ");
      expect(updated).toEqual({
        models: { "sdd-apply": "openai/gpt-5" },
        fallback: { "sdd-apply": "openai/gpt-4.1" },
        configs: { "sdd-apply": { reasoningEffort: "medium" } },
      });
    });

    it("removes entry when value is blank and drops empty configs", () => {
      const updated = updateProfileReasoningEffort({
        models: { "sdd-apply": "openai/gpt-5" },
        configs: { "sdd-apply": { reasoningEffort: "high" } },
      } as any, "sdd-apply", "   ");

      expect(updated).toEqual({ models: { "sdd-apply": "openai/gpt-5" } });
    });
  });

  describe("applyProfileReasoningEffort", () => {
    const providers = [
      {
        id: "openai",
        models: {
          "gpt-5": {
            capabilities: { reasoning: true },
            variants: {
              low: { reasoningEffort: "low" },
              high: { reasoningEffort: "high" },
            },
          },
        },
      },
    ];

    it("applies only valid primary reasoning values", () => {
      const next = applyProfileReasoningEffort({
        agent: {
          "sdd-apply": { model: "openai/gpt-5", options: {} },
          "sdd-apply-fallback": { model: "openai/gpt-4.1" },
        },
      }, {
        models: { "sdd-apply": "openai/gpt-5" },
        configs: {
          "sdd-apply": { reasoningEffort: "high" },
          "sdd-apply-fallback": { reasoningEffort: "low" },
        },
      } as any, providers as any);

      expect(next.config.agent["sdd-apply"].reasoningEffort).toBe("high");
      expect(next.config.agent["sdd-apply"].options.reasoningEffort).toBe("high");
      expect(next.config.agent["sdd-apply-fallback"].reasoningEffort).toBeUndefined();
      expect(next.appliedAgents).toEqual(["sdd-apply"]);
      expect(next.clearedAgents).toEqual([]);
      expect(next.warnings).toEqual([]);
    });

    it("skips stale or unverifiable values and emits warnings", () => {
      const stale = applyProfileReasoningEffort({
        agent: {
          "sdd-apply": { model: "openai/gpt-5", reasoningEffort: "low", options: { reasoningEffort: "low" } },
        },
      }, {
        models: { "sdd-apply": "openai/gpt-5" },
        configs: { "sdd-apply": { reasoningEffort: "medium" } },
      } as any, providers as any);

      expect(stale.appliedAgents).toEqual([]);
      expect(stale.clearedAgents).toEqual(["sdd-apply"]);
      expect(stale.config.agent["sdd-apply"].reasoningEffort).toBeUndefined();
      expect(stale.config.agent["sdd-apply"].options.reasoningEffort).toBeUndefined();
      expect(stale.warnings[0]).toContain("incompatible");

      const missingMetadata = applyProfileReasoningEffort({
        agent: {
          "sdd-apply": { model: "anthropic/sonnet", reasoningEffort: "high", options: { reasoningEffort: "high" } },
        },
      }, {
        models: { "sdd-apply": "anthropic/sonnet" },
        configs: { "sdd-apply": { reasoningEffort: "high" } },
      } as any, providers as any);

      expect(missingMetadata.appliedAgents).toEqual([]);
      expect(missingMetadata.clearedAgents).toEqual(["sdd-apply"]);
      expect(missingMetadata.config.agent["sdd-apply"].reasoningEffort).toBeUndefined();
      expect(missingMetadata.config.agent["sdd-apply"].options.reasoningEffort).toBeUndefined();
      expect(missingMetadata.warnings[0]).toContain("metadata");
    });

    it("applies orchestrator reasoning effort using updated runtime canonical alias", () => {
      const policy = getOrchestratorPolicy(["gentle-orchestrator", "sdd-init"]);
      const next = applyProfileReasoningEffort({
        agent: {
          "gentle-orchestrator": { model: "openai/gpt-5" },
        },
      }, {
        models: { "sdd-orchestrator": "openai/gpt-5" },
        configs: { "sdd-orchestrator": { reasoningEffort: "high" } },
      } as any, providers as any, policy);

      expect(next.config.agent["gentle-orchestrator"].reasoningEffort).toBe("high");
      expect(next.config.agent["sdd-orchestrator"]).toBeUndefined();
      expect(next.appliedAgents).toEqual(["gentle-orchestrator"]);
      expect(next.clearedAgents).toEqual([]);
    });

    it("applies orchestrator reasoning effort using legacy runtime canonical alias", () => {
      const policy = getOrchestratorPolicy(["sdd-orchestrator", "sdd-init"]);
      const next = applyProfileReasoningEffort({
        agent: {
          "sdd-orchestrator": { model: "openai/gpt-5" },
        },
      }, {
        models: { "gentle-orchestrator": "openai/gpt-5" },
        configs: { "gentle-orchestrator": { reasoningEffort: "low" } },
      } as any, providers as any, policy);

      expect(next.config.agent["sdd-orchestrator"].reasoningEffort).toBe("low");
      expect(next.config.agent["gentle-orchestrator"]).toBeUndefined();
      expect(next.appliedAgents).toEqual(["sdd-orchestrator"]);
      expect(next.clearedAgents).toEqual([]);
    });

    it("clears stale reasoning effort for scoped primary agents when profile configs are absent", () => {
      const next = applyProfileReasoningEffort({
        agent: {
          "sdd-init": { model: "openai/gpt-5", reasoningEffort: "high", options: { reasoningEffort: "high" } },
          "sdd-apply": { model: "openai/gpt-5", reasoningEffort: "low", options: { reasoningEffort: "low" } },
          "sdd-plan": { model: "openai/gpt-5", reasoningEffort: "medium" },
        },
      }, {
        models: {
          "sdd-init": "openai/gpt-5",
          "sdd-apply": "openai/gpt-5",
        },
      } as any, providers as any);

      expect(next.config.agent["sdd-init"].reasoningEffort).toBeUndefined();
      expect(next.config.agent["sdd-init"].options.reasoningEffort).toBeUndefined();
      expect(next.config.agent["sdd-apply"].reasoningEffort).toBeUndefined();
      expect(next.config.agent["sdd-apply"].options.reasoningEffort).toBeUndefined();
      expect(next.config.agent["sdd-plan"].reasoningEffort).toBe("medium");
      expect(next.appliedAgents).toEqual([]);
      expect(next.clearedAgents.sort()).toEqual(["sdd-apply", "sdd-init"]);
      expect(next.warnings).toEqual([]);
    });

    it("clears stale orchestrator reasoning effort using updated runtime canonical alias when configs are absent", () => {
      const policy = getOrchestratorPolicy(["gentle-orchestrator", "sdd-init"]);
      const next = applyProfileReasoningEffort({
        agent: {
          "gentle-orchestrator": { model: "openai/gpt-5", reasoningEffort: "high", options: { reasoningEffort: "high" } },
        },
      }, {
        models: {
          "sdd-orchestrator": "openai/gpt-5",
        },
      } as any, providers as any, policy);

      expect(next.config.agent["gentle-orchestrator"].reasoningEffort).toBeUndefined();
      expect(next.config.agent["gentle-orchestrator"].options.reasoningEffort).toBeUndefined();
      expect(next.config.agent["sdd-orchestrator"]).toBeUndefined();
      expect(next.appliedAgents).toEqual([]);
      expect(next.clearedAgents).toEqual(["gentle-orchestrator"]);
      expect(next.warnings).toEqual([]);
    });
  });
});
