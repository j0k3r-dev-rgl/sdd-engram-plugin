#!/usr/bin/env node
/**
 * Ensures SDD orchestrator fallback policy is present in the orchestrator prompt.
 *
 * Supports both prompt shapes:
 * 1) Inline text in opencode.json: agent.sdd-orchestrator.prompt = "..."
 * 2) File reference: agent.sdd-orchestrator.prompt = "{file:/abs/or/rel/path.md}"
 *
 * No external dependencies.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER_START = "<!-- gentle-ai:sdd-fallback-policy -->";
export const MARKER_END = "<!-- /gentle-ai:sdd-fallback-policy -->";

export const FALLBACK_POLICY_BLOCK = [
  MARKER_START,
  "### Sub-Agent Fallback Policy (MANDATORY)",
  "",
  "When delegating to any base SDD executor (`sdd-*`, excluding `sdd-orchestrator` and excluding agents that already end with `-fallback`), you MUST apply this fallback policy:",
  "",
  "1. Launch the primary executor first (for example: `sdd-apply`, `sdd-spec`, `sdd-java-apply`, `sdd-react-router-7-apply`).",
  "2. If the primary delegation fails, returns no usable result, or times out, launch its fallback executor exactly once using the same phase context and task slice:",
  "   - Fallback agent name = `<primary-agent>-fallback`",
  "   - Example: `sdd-apply` -> `sdd-apply-fallback`",
  "3. A result is considered NOT usable when any of these is true:",
  "   - Delegation/tool error",
  "   - Timeout or interrupted execution",
  "   - Empty or missing payload",
  "   - Missing required phase contract fields (`status`, `executive_summary`, `artifacts`, `next_recommended`, `risks`, `skill_resolution`)",
  "4. When launching a fallback agent, DO NOT override the model at orchestration-time. Let the fallback agent use the model configured in `opencode.json` for that `*-fallback` agent.",
  "5. If the fallback succeeds, continue the workflow normally and explicitly report that fallback was used.",
  "6. If both primary and fallback fail, stop that phase and return a clear failure summary with both errors.",
  "",
  "Safety rules:",
  "- Never chain fallback-to-fallback (`*-fallback-fallback`).",
  "- Maximum retries per phase: 1 primary + 1 fallback.",
  "- Keep all other routing rules unchanged (executor routing, strict TDD forwarding, apply-progress continuity).",
  MARKER_END,
].join("\n");

export function resolveCanonicalPromptAgentName(config: any): "sdd-orchestrator" | "gentle-orchestrator" {
  const agents = config?.agent || {};
  if (agents["gentle-orchestrator"]) return "gentle-orchestrator";
  return "sdd-orchestrator";
}

type CliArgs = {
  configPath: string;
  check: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    configPath: resolveDefaultConfigPath(),
    check: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--check") {
      args.check = true;
      continue;
    }

    if (token === "--config") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --config");
      args.configPath = path.resolve(next);
      i += 1;
      continue;
    }
  }

  return args;
}

export function resolveDefaultConfigPath(): string {
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, "opencode", "opencode.json");
}

export function isFilePromptReference(prompt: string): boolean {
  return /^\{file:.+\}$/.test(prompt.trim());
}

export function resolvePromptFilePath(prompt: string, configPath: string): string {
  const trimmed = prompt.trim();
  const rawPath = trimmed.slice("{file:".length, -1).trim();
  if (!rawPath) throw new Error("Invalid {file:...} prompt reference: empty path");
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(path.dirname(configPath), rawPath);
}

export function upsertFallbackPolicy(content: string): { updated: string; changed: boolean } {
  const hasStart = content.includes(MARKER_START);
  const hasEnd = content.includes(MARKER_END);

  if (hasStart && hasEnd) {
    const pattern = new RegExp(`${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}`, "m");
    const replaced = content.replace(pattern, FALLBACK_POLICY_BLOCK);
    return { updated: replaced, changed: replaced !== content };
  }

  const sectionPattern = /(## SDD Workflow[^\n]*\n)/m;
  if (sectionPattern.test(content)) {
    const updated = content.replace(sectionPattern, `$1\n${FALLBACK_POLICY_BLOCK}\n\n`);
    return { updated, changed: updated !== content };
  }

  const separator = content.endsWith("\n") ? "\n" : "\n\n";
  const updated = `${content}${separator}${FALLBACK_POLICY_BLOCK}\n`;
  return { updated, changed: updated !== content };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath: string, data: any): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.configPath)) {
    throw new Error(`Config file not found: ${args.configPath}`);
  }

  const config = readJson(args.configPath);
  const orchestratorAgent = resolveCanonicalPromptAgentName(config);
  const orchestratorPrompt = config?.agent?.[orchestratorAgent]?.prompt;

  if (typeof orchestratorPrompt !== "string" || !orchestratorPrompt.trim()) {
    throw new Error(`agent.${orchestratorAgent}.prompt is missing or not a string`);
  }

  if (isFilePromptReference(orchestratorPrompt)) {
    const promptFilePath = resolvePromptFilePath(orchestratorPrompt, args.configPath);
    if (!fs.existsSync(promptFilePath)) {
      throw new Error(`Orchestrator prompt file not found: ${promptFilePath}`);
    }

    const original = fs.readFileSync(promptFilePath, "utf-8");
    const { updated, changed } = upsertFallbackPolicy(original);

    if (!changed) {
      console.log(`[ok] Fallback policy already up to date in file prompt: ${promptFilePath}`);
      return;
    }

    if (args.check) {
      console.log(`[check] Fallback policy changes required in file prompt: ${promptFilePath}`);
      return;
    }

    fs.writeFileSync(promptFilePath, updated, "utf-8");
    console.log(`[updated] Injected fallback policy into file prompt: ${promptFilePath}`);
    return;
  }

  const { updated, changed } = upsertFallbackPolicy(orchestratorPrompt);
  if (!changed) {
    console.log("[ok] Fallback policy already up to date in inline orchestrator prompt");
    return;
  }

  if (args.check) {
    console.log("[check] Fallback policy changes required in inline orchestrator prompt");
    return;
  }

  config.agent[orchestratorAgent].prompt = updated;
  writeJson(args.configPath, config);
  console.log(`[updated] Injected fallback policy into inline prompt in: ${args.configPath}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);

if (isMain) {
  try {
    main();
  } catch (error: any) {
    console.error(`[error] ${error?.message || String(error)}`);
    process.exit(1);
  }
}
