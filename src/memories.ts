/** @jsxImportSource solid-js */
// @ts-nocheck

/**
 * Engram Memories Logic
 * 
 * Provides direct access to the Engram SQLite database to retrieve 
 * and manage project-specific observations.
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import { resolveProjectCandidates, resolveProjectName } from "./config";
import type { EngramObservation } from "./types";

const ENGRAM_DB = path.join(os.homedir(), ".engram", "engram.db");

/**
 * Parses raw SQLite JSON output into a typed array
 * 
 * @param output - Raw output string from sqlite3 -json
 * @returns Array of parsed objects
 */
function toArrayOutput(output: string): any[] {
  const trimmed = output?.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    return [];
  } catch {}

  const rows: any[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    try {
      const parsed = JSON.parse(row);
      if (Array.isArray(parsed)) rows.push(...parsed);
      else if (parsed && typeof parsed === "object") rows.push(parsed);
    } catch {}
  }

  return rows;
}

/**
 * Normalizes a raw database memory row into a typed EngramObservation
 * 
 * @param memory - Raw memory object from database
 * @param fallbackProject - Project name to use if not present in the record
 * @returns Normalized EngramObservation
 */
function normalizeMemory(memory: any, fallbackProject: string): EngramObservation {
  const id = Number(memory?.id);
  return {
    id: Number.isFinite(id) ? id : 0,
    type: String(memory?.type || "manual"),
    title: typeof memory?.title === "string" ? memory.title : "",
    topic_key: typeof memory?.topic_key === "string" ? memory.topic_key : "",
    content: typeof memory?.content === "string" ? memory.content : "",
    project: String(memory?.project || fallbackProject || "unknown"),
    scope: typeof memory?.scope === "string" && memory.scope ? memory.scope : "project",
    updated_at: typeof memory?.updated_at === "string" ? memory.updated_at : "",
    created_at: typeof memory?.created_at === "string" ? memory.created_at : "",
  };
}

/**
 * Executes a SQLite query and returns results in JSON format
 * 
 * @param query - The SQL query to execute
 * @returns Array of observation results
 */
function execSQLiteJson(query: string): EngramObservation[] {
  try {
    const output = execFileSync(
      "sqlite3",
      ["-json", ENGRAM_DB, query],
      {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );

    return toArrayOutput(output) as EngramObservation[];
  } catch {
    return [];
  }
}

/**
 * Executes a SQLite command without returning results
 * 
 * @param query - The SQL command to execute
 */
function execSQLite(query: string): void {
  execFileSync("sqlite3", [ENGRAM_DB, query], {
    encoding: "utf-8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * Lists all active memories associated with the current project
 * 
 * @param api - The TUI API instance
 * @returns Array of normalized Engram observations
 */
export function listProjectMemories(api: any): EngramObservation[] {
  const projectName = resolveProjectName(api);
  const projectCandidates = resolveProjectCandidates(api);
  const escapedProjects = projectCandidates
    .map((name) => String(name).toLowerCase())
    .map((name) => name.replace(/'/g, "''"))
    .map((name) => `'${name}'`)
    .join(", ");

  if (!escapedProjects) return [];

  const query = `
    SELECT
      id,
      type,
      title,
      content,
      project,
      scope,
      created_at,
      updated_at,
      ifnull(topic_key, '') as topic_key
    FROM observations
    WHERE lower(project) IN (${escapedProjects})
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
  `;

  return execSQLiteJson(query).map((memory) => normalizeMemory(memory, projectName));
}

/**
 * Soft-deletes a specific project memory by setting its deleted_at timestamp
 * 
 * @param memoryId - Unique ID of the memory to delete
 */
export function deleteProjectMemory(memoryId: number): void {
  const safeId = Number(memoryId);
  if (!Number.isInteger(safeId) || safeId <= 0) {
    throw new Error("Invalid Memory ID");
  }

  execSQLite(`
    UPDATE observations
    SET deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ${safeId}
      AND deleted_at IS NULL;
  `);
}
