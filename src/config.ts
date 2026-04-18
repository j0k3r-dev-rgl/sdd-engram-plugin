/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * Plugin Configuration and Path Management
 * 
 * Handles path resolution for config files, profile directories,
 * and project identification.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Collection of core plugin paths
 */
export type Paths = {
  configRoot: string;
  profilesDir: string;
  configPath: string;
  backupPath: string;
};

/**
 * Resolves all necessary system paths for the plugin
 * 
 * @returns Object containing all resolved paths
 */
export function resolvePaths(): Paths {
  const home = os.homedir();
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  const configRoot = path.join(xdgConfig, "opencode");

  return {
    configRoot,
    profilesDir: path.join(configRoot, "profiles"),
    configPath: path.join(configRoot, "opencode.json"),
    backupPath: path.join(configRoot, "opencode.json.bak"),
  };
}

/**
 * Ensures the profiles directory exists, creating it if necessary
 */
export function ensureProfilesDir(): void {
  const { profilesDir } = resolvePaths();
  if (!fs.existsSync(profilesDir)) {
    try {
      fs.mkdirSync(profilesDir, { recursive: true });
    } catch (e) {}
  }
}

/**
 * Resolves a single project name for the current workspace
 * 
 * @param api - The TUI API instance
 * @returns The most likely project name or "unknown"
 */
export function resolveProjectName(api: any): string {
  return resolveProjectCandidates(api)[0] || "unknown";
}

/**
 * Identifies potential project names based on Git remotes, Git root, and directory name
 * 
 * @param api - The TUI API instance
 * @returns Array of unique project name candidates
 */
export function resolveProjectCandidates(api: any): string[] {
  const directory = api?.state?.path?.directory || process.cwd();
  const candidates: string[] = [];

  try {
    const remote = execFileSync("git", ["-C", directory, "remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (remote) {
      const repoName = remote.replace(/\.git$/, "").split(/[/:]/).pop()?.trim().toLowerCase();
      if (repoName) candidates.push(repoName);
    }
  } catch {}

  try {
    const root = execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (root) {
      const rootName = path.basename(root)?.trim().toLowerCase();
      if (rootName) candidates.push(rootName);
    }
  } catch {}

  const dirName = path.basename(directory)?.trim().toLowerCase();
  if (dirName) candidates.push(dirName);

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Resolves the workspace root directory
 * 
 * @param api - The TUI API instance
 * @returns The absolute path to the workspace root
 */
export function resolveWorkspaceRoot(api: any): string {
  return api?.state?.path?.directory || process.cwd();
}
