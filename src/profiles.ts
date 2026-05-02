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
import { randomBytes } from "node:crypto";
import {
  BULK_ASSIGNMENT_MODE,
  BULK_ASSIGNMENT_TARGET,
  BulkAssignmentOperation,
  BulkProfileVersionOperation,
  PhaseProfileVersionOperation,
  PROFILE_PHASE_MODEL_FIELD,
  PROFILE_VERSION_SOURCE,
  ProfilePhaseModelField,
  BulkProfilePhaseAssignmentResult,
  ProfileData,
  ProfileFallbackModels,
  ProfileModels,
  ProfileVersion,
  ProfileVersionMetadata,
  ProfileVersionOperation,
  UpdateProfilePhaseModelResult,
} from "./types";
import {
  isManagedSddAgent,
  isFallbackEligibleSddAgent,
  isPrimarySddAgent,
  isSddFallbackAgent,
} from "./utils";
import { resolvePaths, ensureProfilesDir } from "./config";

const PROFILE_VERSION_FORMAT = 1;
const DEFAULT_PROFILE_VERSION_RETENTION = 60;
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

function isUnassignedProfileValue(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * Checks if a file name represents a valid SDD profile
 *
 * @param fileName - The file name to check
 * @returns True if the file has a .json extension
 */
export function isSddProfile(fileName: string): boolean {
  return fileName.endsWith(".json");
}

export function sanitizeProfileName(profileName: string): string {
  const trimmed = profileName?.trim();
  if (!trimmed) {
    throw new Error("Profile name cannot be empty");
  }

  const baseName = trimmed.replace(/\.json$/i, "");
  if (!baseName || baseName === "." || baseName === "..") {
    throw new Error("Profile name is invalid");
  }

  if (
    baseName.includes("/") ||
    baseName.includes("\\") ||
    baseName.includes("..") ||
    !PROFILE_NAME_PATTERN.test(baseName)
  ) {
    throw new Error("Profile name contains unsafe characters");
  }

  return baseName;
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
    ).map(([name, value]: any) => [name, value.trim()])
  );
}

function normalizeProfileModels(models: unknown): ProfileModels {
  if (!models || typeof models !== "object" || Array.isArray(models)) return {};

  return Object.fromEntries(
    Object.entries(models)
      .filter(([name, value]: any) => isPrimarySddAgent(name) && typeof value === "string" && value.trim())
      .map(([name, value]: any) => [name, value.trim()])
  );
}

function extractPersistedProfileExtras(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => {
      if (key === "models" || key === "fallback" || key === "agent") return false;
      if (isPrimarySddAgent(key) || isSddFallbackAgent(key)) return false;
      return true;
    })
  );
}

function normalizePersistedProfileData(profile: ProfileData): ProfileData {
  const models = normalizeProfileModels(profile?.models);
  const fallback = extractSddFallbackModels({ fallback: profile?.fallback || {} });

  return {
    ...extractPersistedProfileExtras(profile),
    models,
    ...(Object.keys(fallback).length > 0 ? { fallback } : {}),
  };
}

/**
 * Reads and parses SDD agent models from a profile file.
 * Supports full config objects, legacy flat maps, and the new profile payload shape.
 *
 * @param profilePath - Absolute path to the profile file
 * @returns Mapping of SDD agent names to their model IDs
 */
export function readProfileModels(profilePath: string): ProfileModels {
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
  } catch {
    return {};
  }

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
  try {
    const rawContent = fs.readFileSync(profilePath, "utf-8").toString();
    return readProfileDataFromRaw(rawContent);
  } catch {
    return { models: {} };
  }
}

function readProfileDataFromRaw(rawContent: string): ProfileData {
  let raw: any;
  try {
    raw = JSON.parse(rawContent);
  } catch {
    return { models: {} };
  }

  let models: ProfileModels;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.models && typeof raw.models === "object") {
    models = Object.fromEntries(
      Object.entries(raw.models)
        .filter(([name, value]: any) => isPrimarySddAgent(name) && typeof value === "string" && value.trim())
        .map(([name, value]: any) => [name, value])
    );
  } else if (raw && typeof raw === "object" && !Array.isArray(raw) && !raw.agent && !raw.models) {
    models = Object.fromEntries(
      Object.entries(raw)
        .filter(
          ([name, value]: any) =>
            isPrimarySddAgent(name) &&
            ((typeof value === "string" && value) || (typeof value?.model === "string" && value.model))
        )
        .map(([name, value]: any) => [name, typeof value === "string" ? value : value.model])
    );
  } else {
    models = extractSddAgentModels(raw);
  }

  const fallback = extractSddFallbackModels(raw);
  return {
    ...extractPersistedProfileExtras(raw),
    models,
    ...(Object.keys(fallback).length > 0
      ? { fallback }
      : {}),
  };
}

/**
 * Persists full profile data while preserving the existing profile payload shape.
 */
export function writeProfileData(profilePath: string, profile: ProfileData): void {
  atomicWriteFile(profilePath, JSON.stringify(normalizePersistedProfileData(profile), null, 2));
}

function normalizePrimarySddAgentNames(primarySddAgentNames: string[]): string[] {
  return Array.from(new Set(primarySddAgentNames))
    .filter((name) => isPrimarySddAgent(name) && !isSddFallbackAgent(name));
}

function shouldAssignValue(currentValue: unknown, mode: string): boolean {
  return mode === BULK_ASSIGNMENT_MODE.OVERWRITE || isUnassignedProfileValue(currentValue);
}

function safeProfileFileName(profilePathOrFile: string): string {
  const fileName = path.basename(profilePathOrFile);
  if (!isSddProfile(fileName) || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    throw new Error("Invalid profile file name");
  }
  return fileName;
}

function resolveProfileVersionDir(profilePathOrFile: string): string {
  const { profileVersionsDir } = resolvePaths();
  return path.join(profileVersionsDir, safeProfileFileName(profilePathOrFile));
}

function sanitizeTimestampForFileName(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function parseVersionId(versionId: string): { profileFile: string; versionFile: string } {
  const parts = versionId.split("/");
  if (parts.length !== 2) throw new Error("Invalid profile version id");
  const [profileFile, versionFile] = parts;
  try {
    if (profileFile !== safeProfileFileName(profileFile)) throw new Error("Invalid profile version id");
  } catch {
    throw new Error("Invalid profile version id");
  }
  if (path.basename(versionFile) !== versionFile || !versionFile.endsWith(".json") || versionFile.includes("..")) {
    throw new Error("Invalid profile version id");
  }
  return { profileFile, versionFile };
}

function resolveProfileVersionPath(versionId: string): string {
  const { profileFile, versionFile } = parseVersionId(versionId);
  return path.join(resolveProfileVersionDir(profileFile), versionFile);
}

function atomicWriteFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp-${randomBytes(4).toString("hex")}`;
  let tempFd: number | undefined;
  let dirFd: number | undefined;
  let renameCompleted = false;

  try {
    fs.writeFileSync(tmpPath, content);

    tempFd = fs.openSync(tmpPath, "r+");
    try { fs.fsyncSync(tempFd); } catch (e: any) { if (e?.code !== "EPERM") throw e; }
    fs.closeSync(tempFd);
    tempFd = undefined;

    fs.renameSync(tmpPath, filePath);
    renameCompleted = true;

    dirFd = fs.openSync(path.dirname(filePath), "r");
    try { fs.fsyncSync(dirFd); } catch (e: any) { if (e?.code !== "EPERM") throw e; }
  } finally {
    if (typeof tempFd === "number") {
      fs.closeSync(tempFd);
    }
    if (typeof dirFd === "number") {
      fs.closeSync(dirFd);
    }

    if (!renameCompleted) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
  }
}

function buildEmptyProfilePreview(): { models: ProfileModels; fallback: ProfileFallbackModels } {
  return { models: {}, fallback: {} };
}

function buildRenamedProfileVersion(versionFile: string, versionRaw: string, oldProfileFile: string, newProfileFile: string): ProfileVersion {
  const oldVersionId = `${oldProfileFile}/${versionFile}`;
  const newVersionId = `${newProfileFile}/${versionFile}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(versionRaw);
  } catch {
    throw new Error("Invalid profile version data");
  }
  if (
    parsed?.version !== PROFILE_VERSION_FORMAT ||
    parsed?.id !== oldVersionId ||
    parsed?.profileFile !== oldProfileFile
  ) {
    throw new Error("Invalid profile version data");
  }

  return normalizeProfileVersion(
    {
      ...parsed,
      id: newVersionId,
      profileFile: newProfileFile,
    },
    newVersionId
  );
}

function buildOperationSummary(operation: BulkAssignmentOperation, modelsAssigned: number, fallbackAssigned: number): string {
  const action = operation.mode === BULK_ASSIGNMENT_MODE.OVERWRITE ? "Override" : "Set";
  const target = operation.target === BULK_ASSIGNMENT_TARGET.BOTH
    ? "all phases and fallbacks"
    : operation.target === BULK_ASSIGNMENT_TARGET.PRIMARY
      ? "all primary phases"
      : "all fallback phases";
  return `${action} ${target}: ${modelsAssigned} primary, ${fallbackAssigned} fallback`;
}

function normalizeBulkVersionOperation(
  operation: BulkAssignmentOperation | BulkProfileVersionOperation,
  changedPhases?: number
): BulkProfileVersionOperation {
  return {
    ...operation,
    source: PROFILE_VERSION_SOURCE.BULK,
    ...(typeof changedPhases === "number" ? { changedPhases } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue === "string")
      .map(([key, entryValue]) => [key, entryValue.trim()])
  );
}

function normalizePersistedBulkVersionOperation(operation: unknown): BulkProfileVersionOperation | null {
  if (!isRecord(operation)) return null;
  if (
    operation.target !== BULK_ASSIGNMENT_TARGET.PRIMARY &&
    operation.target !== BULK_ASSIGNMENT_TARGET.FALLBACK &&
    operation.target !== BULK_ASSIGNMENT_TARGET.BOTH
  ) {
    return null;
  }
  if (
    operation.mode !== BULK_ASSIGNMENT_MODE.FILL_ONLY &&
    operation.mode !== BULK_ASSIGNMENT_MODE.OVERWRITE
  ) {
    return null;
  }

  return normalizeBulkVersionOperation(
    {
      target: operation.target,
      mode: operation.mode,
    },
    typeof operation.changedPhases === "number" ? operation.changedPhases : undefined
  );
}

function normalizePersistedPhaseVersionOperation(operation: unknown): PhaseProfileVersionOperation | null {
  if (!isRecord(operation)) return null;
  if (!isPrimarySddAgent(operation.phase) || isSddFallbackAgent(operation.phase)) return null;
  if (
    operation.field !== PROFILE_PHASE_MODEL_FIELD.PRIMARY &&
    operation.field !== PROFILE_PHASE_MODEL_FIELD.FALLBACK
  ) {
    return null;
  }
  if (typeof operation.modelId !== "string" || !operation.modelId.trim()) return null;

  return {
    source: PROFILE_VERSION_SOURCE.PHASE,
    phase: operation.phase,
    field: operation.field,
    modelId: operation.modelId.trim(),
    changedPhases: 1,
  };
}

function normalizePersistedProfileVersionOperation(
  source: unknown,
  operation: unknown
): ProfileVersionOperation | null {
  if (source === PROFILE_VERSION_SOURCE.PHASE) {
    return normalizePersistedPhaseVersionOperation(operation);
  }
  return normalizePersistedBulkVersionOperation(operation);
}

function normalizePersistedProfileVersionPreview(preview: unknown): ProfileVersion["preview"] | null {
  if (!isRecord(preview)) return null;

  const models = sanitizeStringRecord(preview.models);
  const fallback = sanitizeStringRecord(preview.fallback);
  if (!models || !fallback) return null;

  return {
    models: normalizeProfileModels(models),
    fallback: extractSddFallbackModels({ fallback }),
  };
}

function normalizeProfileVersionOperation(operation: BulkAssignmentOperation | ProfileVersionOperation): ProfileVersionOperation {
  if ((operation as ProfileVersionOperation).source === PROFILE_VERSION_SOURCE.PHASE) {
    return operation as PhaseProfileVersionOperation;
  }
  return normalizeBulkVersionOperation(operation as BulkAssignmentOperation | BulkProfileVersionOperation);
}

function normalizeProfileVersion(parsed: unknown, versionId: string): ProfileVersion {
  if (!isRecord(parsed)) {
    throw new Error("Invalid profile version data");
  }

  const source = parsed.source === undefined
    ? PROFILE_VERSION_SOURCE.BULK
    : parsed.source === PROFILE_VERSION_SOURCE.BULK || parsed.source === PROFILE_VERSION_SOURCE.PHASE
      ? parsed.source
      : null;
  const operation = normalizePersistedProfileVersionOperation(source, parsed.operation);
  const preview = normalizePersistedProfileVersionPreview(parsed.preview);
  if (
    parsed.version !== PROFILE_VERSION_FORMAT ||
    parsed.id !== versionId ||
    parsed.profileFile !== parseVersionId(versionId).profileFile ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.operationSummary !== "string" ||
    typeof parsed.beforeRaw !== "string" ||
    !source ||
    !operation ||
    !preview
  ) {
    throw new Error("Invalid profile version data");
  }

  return {
    ...parsed,
    source,
    operation,
    id: versionId,
    createdAt: parsed.createdAt,
    operationSummary: parsed.operationSummary,
    beforeRaw: parsed.beforeRaw,
    preview,
  };
}

function buildPhaseOperationSummary(agentName: string, field: ProfilePhaseModelField, modelId: string): string {
  return `Set ${agentName} ${field} model to ${modelId}`;
}

function readProfilePreviewFromRaw(beforeRaw: string): { models: ProfileModels; fallback: ProfileFallbackModels } {
  try {
    const raw = JSON.parse(beforeRaw);
    return {
      models: raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw.models && typeof raw.models === "object" && !Array.isArray(raw.models)
          ? Object.fromEntries(
              Object.entries(raw.models).filter(([name, value]: any) => isPrimarySddAgent(name) && typeof value === "string")
            )
          : extractSddAgentModels(raw)
        : {},
      fallback: extractSddFallbackModels(raw),
    };
  } catch {
    return buildEmptyProfilePreview();
  }
}

/**
 * Applies a bulk profile assignment for the selected target/mode without mutating input.
 */
export function applyBulkProfilePhaseAssignment(
  profile: ProfileData,
  primarySddAgentNames: string[],
  modelId: string,
  operation: BulkAssignmentOperation
): BulkProfilePhaseAssignmentResult {
  const trimmedModelId = modelId?.trim();
  if (!trimmedModelId) {
    throw new Error("modelId must be a non-empty string");
  }

  const nextModels: ProfileModels = { ...(profile?.models || {}) };
  const nextFallback: ProfileFallbackModels = { ...(profile?.fallback || {}) };
  const primaryAgentNames = normalizePrimarySddAgentNames(primarySddAgentNames);
  let modelsAssigned = 0;
  let fallbackAssigned = 0;
  let changed = false;

  const shouldAssignPrimary = operation.target === BULK_ASSIGNMENT_TARGET.PRIMARY || operation.target === BULK_ASSIGNMENT_TARGET.BOTH;
  const shouldAssignFallback = operation.target === BULK_ASSIGNMENT_TARGET.FALLBACK || operation.target === BULK_ASSIGNMENT_TARGET.BOTH;

  for (const agentName of primaryAgentNames) {
    if (shouldAssignPrimary && shouldAssignValue(nextModels[agentName], operation.mode)) {
      if (nextModels[agentName] !== trimmedModelId) {
        nextModels[agentName] = trimmedModelId;
        modelsAssigned += 1;
        changed = true;
      }
    }

    if (shouldAssignFallback && isFallbackEligibleSddAgent(agentName) && shouldAssignValue(nextFallback[agentName], operation.mode)) {
      if (nextFallback[agentName] !== trimmedModelId) {
        nextFallback[agentName] = trimmedModelId;
        fallbackAssigned += 1;
        changed = true;
      }
    }
  }

  return {
    profile: {
      ...(profile || {}),
      models: nextModels,
      fallback: nextFallback,
    },
    modelsAssigned,
    fallbackAssigned,
    changed,
  };
}

/**
 * Assigns a model to every unassigned SDD phase in a profile without overwriting
 * existing non-empty primary or fallback assignments.
 */
export function assignModelToUnassignedProfilePhases(
  profile: ProfileData,
  primarySddAgentNames: string[],
  modelId: string
): BulkProfilePhaseAssignmentResult {
  return applyBulkProfilePhaseAssignment(profile, primarySddAgentNames, modelId, {
    target: BULK_ASSIGNMENT_TARGET.BOTH,
    mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
  });
}

function pruneProfileVersions(profileFile: string, retention: number): void {
  const versionDir = resolveProfileVersionDir(profileFile);
  if (!fs.existsSync(versionDir)) return;
  const files = fs.readdirSync(versionDir).filter((file) => String(file).endsWith(".json")).sort().reverse();
  for (const staleFile of files.slice(retention)) {
    fs.unlinkSync(path.join(versionDir, staleFile));
  }
}

export function createProfileVersion(
  profilePath: string,
  operation: BulkAssignmentOperation | ProfileVersionOperation,
  operationSummary: string,
  retention = DEFAULT_PROFILE_VERSION_RETENTION,
  beforeRawOverride?: string
): ProfileVersion {
  const profileFile = safeProfileFileName(profilePath);
  const versionDir = resolveProfileVersionDir(profileFile);
  if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

  const beforeRaw = typeof beforeRawOverride === "string"
    ? beforeRawOverride
    : fs.readFileSync(profilePath, "utf-8").toString();
  const createdAt = new Date().toISOString();
  const versionFile = `${sanitizeTimestampForFileName(createdAt)}-${Math.random().toString(36).slice(2, 8)}.json`;
  const id = `${profileFile}/${versionFile}`;
  const versionOperation = normalizeProfileVersionOperation(operation);
  const version: ProfileVersion = {
    version: PROFILE_VERSION_FORMAT,
    id,
    profileFile,
    createdAt,
    source: versionOperation.source,
    operation: versionOperation,
    operationSummary,
    beforeRaw,
    preview: readProfilePreviewFromRaw(beforeRaw),
  };

  const versionPath = path.join(versionDir, versionFile);
  atomicWriteFile(versionPath, JSON.stringify(version, null, 2));
  pruneProfileVersions(profileFile, retention);
  return version;
}

export function readProfileVersion(versionId: string): ProfileVersion {
  const versionPath = resolveProfileVersionPath(versionId);
  if (!fs.existsSync(versionPath)) throw new Error("Profile version not found");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(versionPath, "utf-8").toString());
  } catch {
    throw new Error("Invalid profile version data");
  }
  if (parsed?.version !== PROFILE_VERSION_FORMAT || parsed?.id !== versionId || parsed?.profileFile !== parseVersionId(versionId).profileFile) {
    throw new Error("Invalid profile version data");
  }
  return normalizeProfileVersion(parsed, versionId);
}

export function listProfileVersions(profilePathOrFile: string): ProfileVersionMetadata[] {
  const profileFile = safeProfileFileName(profilePathOrFile);
  const versionDir = resolveProfileVersionDir(profileFile);
  if (!fs.existsSync(versionDir)) return [];

  return fs.readdirSync(versionDir)
    .filter((file) => String(file).endsWith(".json"))
    .map((file) => {
      try {
        const versionId = `${profileFile}/${file}`;
        const versionPath = path.join(versionDir, file);
        const parsed = JSON.parse(fs.readFileSync(versionPath, "utf-8").toString());
        return normalizeProfileVersion(parsed, versionId);
      } catch {
        return null;
      }
    })
    .filter((version): version is ProfileVersion => Boolean(version))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ beforeRaw, ...metadata }) => metadata);
}

export function restoreProfileVersion(profilePathOrFile: string, versionId: string): ProfileVersion {
  const profileFile = safeProfileFileName(profilePathOrFile);
  const version = readProfileVersion(versionId);
  if (version.profileFile !== profileFile) {
    throw new Error("Profile version does not match selected profile");
  }
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, profileFile);
  createProfileVersion(
    profilePath,
    {
      source: PROFILE_VERSION_SOURCE.BULK,
      target: BULK_ASSIGNMENT_TARGET.BOTH,
      mode: BULK_ASSIGNMENT_MODE.OVERWRITE,
    },
    `Snapshot before restoring ${path.basename(versionId)}`
  );
  atomicWriteFile(profilePath, version.beforeRaw);
  return version;
}

export function updateProfileWithBulkPhaseAssignment(
  profilePath: string,
  primarySddAgentNames: string[],
  modelId: string,
  operation: BulkAssignmentOperation
): { assignment: BulkProfilePhaseAssignmentResult; version?: ProfileVersion } {
  const beforeRaw = fs.readFileSync(profilePath, "utf-8").toString();
  const profileData = readProfileDataFromRaw(beforeRaw);
  const assignment = applyBulkProfilePhaseAssignment(profileData, primarySddAgentNames, modelId, operation);
  if (!assignment.changed) return { assignment };

  const version = createProfileVersion(
    profilePath,
    normalizeBulkVersionOperation(operation, assignment.modelsAssigned + assignment.fallbackAssigned),
    buildOperationSummary(operation, assignment.modelsAssigned, assignment.fallbackAssigned),
    DEFAULT_PROFILE_VERSION_RETENTION,
    beforeRaw
  );
  writeProfileData(profilePath, assignment.profile);
  return { assignment, version };
}

export function updateProfilePhaseModel(
  profilePath: string,
  agentName: string,
  field: ProfilePhaseModelField,
  modelId: string
): UpdateProfilePhaseModelResult {
  const trimmedModelId = modelId?.trim();
  if (!trimmedModelId) {
    throw new Error("modelId must be a non-empty string");
  }
  if (!isPrimarySddAgent(agentName) || isSddFallbackAgent(agentName)) {
    throw new Error("agentName must be a primary SDD agent");
  }
  if (field === PROFILE_PHASE_MODEL_FIELD.FALLBACK && !isFallbackEligibleSddAgent(agentName)) {
    throw new Error("agentName is not eligible for fallback models");
  }

  const profileData = readProfileData(profilePath);
  const currentValue = field === PROFILE_PHASE_MODEL_FIELD.FALLBACK
    ? profileData.fallback?.[agentName]
    : profileData.models?.[agentName];
  if (currentValue === trimmedModelId) {
    return { profile: profileData, changed: false };
  }

  const nextProfile: ProfileData = {
    ...profileData,
    models: { ...(profileData.models || {}) },
    fallback: { ...(profileData.fallback || {}) },
  };

  if (field === PROFILE_PHASE_MODEL_FIELD.FALLBACK) {
    nextProfile.fallback = { ...(nextProfile.fallback || {}), [agentName]: trimmedModelId };
  } else {
    nextProfile.models = { ...(nextProfile.models || {}), [agentName]: trimmedModelId };
  }

  const operation: PhaseProfileVersionOperation = {
    source: PROFILE_VERSION_SOURCE.PHASE,
    phase: agentName,
    field,
    modelId: trimmedModelId,
    changedPhases: 1,
  };
  const version = createProfileVersion(profilePath, operation, buildPhaseOperationSummary(agentName, field, trimmedModelId));
  writeProfileData(profilePath, nextProfile);
  return { profile: nextProfile, changed: true, version };
}

/**
 * Persists SDD agent model mappings to a profile file,
 * preserving fallback mappings if present.
 *
 * @param profilePath - Absolute path where the profile will be saved
 * @param models - Mapping of SDD agent names to their model IDs
 */
export function writeProfileModels(profilePath: string, models: ProfileModels): void {
  const currentProfile = readProfileData(profilePath);
  const fallback = currentProfile.fallback || {};
  const payload: ProfileData = {
    ...currentProfile,
    models,
    ...(Object.keys(fallback).length > 0 ? { fallback } : {}),
  };
  writeProfileData(profilePath, payload);
}

/**
 * Writes fallback model overrides while preserving primary models
 */
export function writeProfileFallbackModels(profilePath: string, fallback: ProfileFallbackModels): void {
  const currentProfile = readProfileData(profilePath);
  const models = currentProfile.models || {};
  const payload: ProfileData = {
    ...currentProfile,
    models,
    ...(Object.keys(fallback).length > 0 ? { fallback } : {}),
  };
  writeProfileData(profilePath, payload);
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
export function applyProfileDataToConfig(currentConfig: any, profile: ProfileData): any {
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
      try {
        currentConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch {
        throw new Error("Global config JSON is invalid");
      }
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
  const safeFileName = safeProfileFileName(fileName);
  const profilePath = path.join(profilesDir, safeFileName);
  fs.unlinkSync(profilePath);

  const versionDir = resolveProfileVersionDir(safeFileName);
  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }
}

/**
 * Renames an existing profile file
 *
 * @param oldFileName - Original file name
 * @param newFileName - New file name
 */
export function renameProfileFile(oldFileName: string, newFileName: string): void {
  const { profilesDir } = resolvePaths();
  const safeOldFileName = safeProfileFileName(oldFileName);
  const safeNewFileName = safeProfileFileName(newFileName);
  const oldPath = path.join(profilesDir, safeOldFileName);
  const newPath = path.join(profilesDir, safeNewFileName);
  const oldVersionDir = resolveProfileVersionDir(safeOldFileName);
  const newVersionDir = resolveProfileVersionDir(safeNewFileName);
  if (!fs.existsSync(oldPath)) {
    throw new Error("Profile file not found");
  }
  if (fs.existsSync(newPath)) {
    throw new Error("Target profile file already exists");
  }
  if (fs.existsSync(newVersionDir)) {
    throw new Error("Target profile version history already exists");
  }

  const migratedVersions = fs.existsSync(oldVersionDir)
    ? fs.readdirSync(oldVersionDir)
      .filter((file) => String(file).endsWith(".json"))
      .map((file) => {
        const versionFile = String(file);
        const versionPath = path.join(oldVersionDir, versionFile);
        const originalContent = fs.readFileSync(versionPath, "utf-8").toString();
        try {
          const version = buildRenamedProfileVersion(
            versionFile,
            originalContent,
            safeOldFileName,
            safeNewFileName
          );
          return {
            versionFile,
            rewrittenContent: JSON.stringify(version, null, 2),
            originalContent,
          };
        } catch {
          return null;
        }
      })
      .filter((version): version is { versionFile: string; rewrittenContent: string; originalContent: string } => Boolean(version))
    : [];

  let profileRenamed = false;
  let versionDirRenamed = false;
  const rewrittenVersionContents = new Map<string, string>();

  try {
    if (fs.existsSync(oldVersionDir)) {
      fs.renameSync(oldVersionDir, newVersionDir);
      versionDirRenamed = true;
    }

    fs.renameSync(oldPath, newPath);
    profileRenamed = true;

    if (!versionDirRenamed) return;

    for (const migratedVersion of migratedVersions) {
      const versionPath = path.join(newVersionDir, migratedVersion.versionFile);
      rewrittenVersionContents.set(versionPath, migratedVersion.originalContent);
      atomicWriteFile(versionPath, migratedVersion.rewrittenContent);
    }
  } catch (error) {
    for (const [versionPath, originalContent] of rewrittenVersionContents.entries()) {
      try {
        atomicWriteFile(versionPath, originalContent);
      } catch {}
    }

    if (profileRenamed) {
      try {
        fs.renameSync(newPath, oldPath);
      } catch {}
    }

    if (versionDirRenamed) {
      try {
        fs.renameSync(newVersionDir, oldVersionDir);
      } catch {}
    }

    throw error;
  }
}
