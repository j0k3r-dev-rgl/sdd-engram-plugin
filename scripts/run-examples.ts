#!/usr/bin/env node
/**
 * Lightweight example runner (no dependencies) that validates:
 * 1) Orchestrator fallback policy injection for inline prompt config
 * 2) Orchestrator fallback policy injection for external file prompt config
 * 3) Profile fixture readability for new and legacy profile formats
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getOrchestratorPolicy } from "../src/orchestrator.ts";

type TestResult = { name: string; ok: boolean; details?: string };

const MARKER_START = "<!-- gentle-ai:sdd-fallback-policy -->";

function ensureDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFile(src: string, dst: string): void {
  ensureDirExists(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function runScript(args: string[], cwd: string): { code: number; out: string; err: string } {
  const result = spawnSync("node", ["./scripts/ensure-orchestrator-fallback-policy.ts", ...args], {
    cwd,
    encoding: "utf-8",
  });
  return {
    code: result.status ?? 1,
    out: result.stdout || "",
    err: result.stderr || "",
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function testInlinePromptInjection(repoRoot: string, tempDir: string): TestResult {
  const name = "inline prompt injection";
  try {
    const src = path.join(repoRoot, "examples", "opencode-inline.json");
    const dst = path.join(tempDir, "opencode-inline.json");
    copyFile(src, dst);

    const apply = runScript(["--config", dst], repoRoot);
    assert(apply.code === 0, `apply failed: ${apply.err || apply.out}`);

    const updated = JSON.parse(fs.readFileSync(dst, "utf-8"));
    const prompt = updated?.agent?.["sdd-orchestrator"]?.prompt;
    assert(typeof prompt === "string", "inline prompt is not a string after apply");
    assert(prompt.includes(MARKER_START), "fallback policy marker missing in inline prompt");

    const check = runScript(["--check", "--config", dst], repoRoot);
    assert(check.code === 0, `check failed: ${check.err || check.out}`);
    assert(check.out.includes("already up to date"), "idempotent check did not report up-to-date");

    return { name, ok: true };
  } catch (error: any) {
    return { name, ok: false, details: error?.message || String(error) };
  }
}

function testExternalPromptInjection(repoRoot: string, tempDir: string): TestResult {
  const name = "external file prompt injection";
  try {
    const srcConfig = path.join(repoRoot, "examples", "opencode-external.json");
    const srcPrompt = path.join(repoRoot, "examples", "sdd-orchestrator-example.md");

    const workDir = path.join(tempDir, "external");
    ensureDirExists(workDir);

    const dstConfig = path.join(workDir, "opencode-external.json");
    const dstPrompt = path.join(workDir, "sdd-orchestrator-example.md");

    copyFile(srcConfig, dstConfig);
    copyFile(srcPrompt, dstPrompt);

    const apply = runScript(["--config", dstConfig], repoRoot);
    assert(apply.code === 0, `apply failed: ${apply.err || apply.out}`);

    const promptContent = fs.readFileSync(dstPrompt, "utf-8");
    assert(promptContent.includes(MARKER_START), "fallback policy marker missing in external prompt file");

    const check = runScript(["--check", "--config", dstConfig], repoRoot);
    assert(check.code === 0, `check failed: ${check.err || check.out}`);
    assert(check.out.includes("already up to date"), "idempotent check did not report up-to-date");

    return { name, ok: true };
  } catch (error: any) {
    return { name, ok: false, details: error?.message || String(error) };
  }
}

function isManagedSddAgent(name: string): boolean {
  return name.startsWith("sdd-");
}

function isFallbackEligibleSddAgent(name: string): boolean {
  const policy = getOrchestratorPolicy([name]);
  return isManagedSddAgent(name) && name !== policy.canonicalName && !name.endsWith("-fallback");
}

function parseProfileModels(raw: any): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.models && typeof raw.models === "object") {
    return Object.fromEntries(
      Object.entries(raw.models).filter(
        ([name, value]: any) => isManagedSddAgent(name) && !name.endsWith("-fallback") && typeof value === "string" && value
      )
    ) as Record<string, string>;
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw) && !raw.agent && !raw.models) {
    return Object.fromEntries(
      Object.entries(raw).filter(
        ([name, value]: any) => isManagedSddAgent(name) && typeof value === "string" && value
      )
    ) as Record<string, string>;
  }

  const agent = raw?.agent || {};
  return Object.fromEntries(
    Object.entries(agent)
      .filter(
        ([name, value]: any) => isManagedSddAgent(name) && !name.endsWith("-fallback") && typeof value?.model === "string" && value.model
      )
      .map(([name, value]: any) => [name, value.model])
  );
}

function parseProfileFallback(raw: any): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const fallback = raw.fallback && typeof raw.fallback === "object" && !Array.isArray(raw.fallback) ? raw.fallback : {};
  return Object.fromEntries(
    Object.entries(fallback).filter(
      ([name, value]: any) => isFallbackEligibleSddAgent(name) && typeof value === "string" && value
    )
  ) as Record<string, string>;
}

function testProfileFixtures(repoRoot: string): TestResult {
  const name = "profile fixtures readability";
  try {
    const fixturePaths = [
      path.join(repoRoot, "examples", "profiles", "fallback-minimal.json"),
      path.join(repoRoot, "examples", "profiles", "fallback-full.json"),
      path.join(repoRoot, "examples", "profiles", "legacy-flat.json"),
    ];

    for (const fixture of fixturePaths) {
      const raw = JSON.parse(fs.readFileSync(fixture, "utf-8"));
      const models = parseProfileModels(raw);
      assert(models && typeof models === "object", `models parse failed for fixture: ${fixture}`);
      assert(Object.keys(models).length > 0, `no models parsed for fixture: ${fixture}`);

      const fallback = parseProfileFallback(raw);
      assert(fallback && typeof fallback === "object", `fallback parse failed for fixture: ${fixture}`);
    }

    return { name, ok: true };
  } catch (error: any) {
    return { name, ok: false, details: error?.message || String(error) };
  }
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const tempDir = path.join(repoRoot, "examples", ".tmp-run");
  ensureDirExists(tempDir);

  const results: TestResult[] = [];
  results.push(testInlinePromptInjection(repoRoot, tempDir));
  results.push(testExternalPromptInjection(repoRoot, tempDir));
  results.push(testProfileFixtures(repoRoot));

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    if (r.ok) console.log(`✅ ${r.name}`);
    else console.log(`❌ ${r.name}: ${r.details}`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[error] ${error?.message || String(error)}`);
  process.exit(1);
});
