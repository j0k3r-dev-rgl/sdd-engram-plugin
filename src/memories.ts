/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * Engram Memories Logic
 * 
 * Provides access to the Engram HTTP API server to retrieve 
 * and manage project-specific observations.
 */

import * as path from "node:path";
import { resolveProjectCandidates, resolveProjectName } from "./config";
import { createLogger } from "./logger";
import type { EngramObservation } from "./types";

const log = createLogger("memories");

const ENGRAM_PORT = parseInt(process.env.ENGRAM_PORT ?? "7437");
const ENGRAM_URL = `http://127.0.0.1:${ENGRAM_PORT}`;

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
 * Lists all active memories associated with the current project using the Engram HTTP API
 * 
 * @param api - The TUI API instance
 * @returns Array of normalized Engram observations
 */
export async function listProjectMemories(api: any): Promise<EngramObservation[]> {
  const projectName = resolveProjectName(api);
  const projectCandidates = resolveProjectCandidates(api);

  if (projectCandidates.length === 0) return [];

  try {
    // Call the API for each candidate to ensure we don't miss memories associated with aliases
    // The server implementation of /observations/recent handles a single project parameter.
    const allResults = await Promise.all(
      projectCandidates.map(async (project) => {
        try {
          const res = await fetch(`${ENGRAM_URL}/observations/recent?project=${encodeURIComponent(project)}&limit=50`, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(3000),
          });
          return res.ok ? await res.json() : [];
        } catch (error) {
          log.warn(`listProjectMemories: failed to fetch recent observations for candidate '${project}'`, error);
          return [];
        }
      })
    );

    const flatData = allResults.flat();
    if (!Array.isArray(flatData) || flatData.length === 0) return [];

    // Deduplicate by ID and normalize
    const seenIds = new Set<number>();
    const uniqueMemories = [];

    for (const memory of flatData) {
      if (memory?.id && !seenIds.has(memory.id)) {
        seenIds.add(memory.id);
        uniqueMemories.push(normalizeMemory(memory, projectName));
      }
    }

    // Sort by updated_at or created_at descending (latest first)
    return uniqueMemories.sort((a, b) => {
      const dateA = a.updated_at || a.created_at || "";
      const dateB = b.updated_at || b.created_at || "";
      return dateB.localeCompare(dateA);
    });
  } catch (error) {
    log.error("listProjectMemories: failed to list project memories via Engram API", error);
    return [];
  }
}

/**
 * Soft-deletes a specific project memory by calling the Engram HTTP API
 * 
 * @param memoryId - Unique ID of the memory to delete
 */
export async function deleteProjectMemory(memoryId: number): Promise<void> {
  const safeId = Number(memoryId);
  if (!Number.isInteger(safeId) || safeId <= 0) {
    throw new Error("Invalid Memory ID");
  }

  try {
    const res = await fetch(`${ENGRAM_URL}/observations/${safeId}`, {
      method: "DELETE",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      throw new Error(`Engram API delete returned ${res.status}: ${res.statusText}`);
    }
  } catch (error) {
    log.error(`deleteProjectMemory: failed to delete memory ${safeId} via Engram API`, error);
    throw error;
  }
}
