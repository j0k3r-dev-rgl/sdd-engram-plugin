/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * Shared Types for SDD Model Select Plugin
 */

/**
 * Represents the currently active profile's configuration
 */
export type ActiveProfileState = {
  modelId: string;
  contextLimit: number | null;
  providerName: string;
  modelName: string;
  reasoningEffort?: string;
};

/**
 * Mapping of profile names to their model identifiers
 */
export type ProfileModels = Record<string, string>;

/**
 * Mapping of fallback model overrides by base SDD agent name
 */
export type ProfileFallbackModels = Record<string, string>;

export type ProfileAgentConfig = {
  reasoningEffort?: string;
};

export type ProfileConfigs = Record<string, ProfileAgentConfig>;

/**
 * Full profile payload persisted to disk
 */
export type ProfileData = {
  models: ProfileModels;
  fallback?: ProfileFallbackModels;
  configs?: ProfileConfigs;
};

export const BULK_ASSIGNMENT_TARGET = {
  PRIMARY: "primary",
  FALLBACK: "fallback",
  BOTH: "both",
} as const;

export type BulkAssignmentTarget = (typeof BULK_ASSIGNMENT_TARGET)[keyof typeof BULK_ASSIGNMENT_TARGET];

export const BULK_ASSIGNMENT_MODE = {
  FILL_ONLY: "fill-only",
  OVERWRITE: "overwrite",
} as const;

export type BulkAssignmentMode = (typeof BULK_ASSIGNMENT_MODE)[keyof typeof BULK_ASSIGNMENT_MODE];

export type BulkAssignmentOperation = {
  target: BulkAssignmentTarget;
  mode: BulkAssignmentMode;
};

export const PROFILE_VERSION_SOURCE = {
  BULK: "bulk",
  PHASE: "phase",
} as const;

export type ProfileVersionSource = (typeof PROFILE_VERSION_SOURCE)[keyof typeof PROFILE_VERSION_SOURCE];

export const PROFILE_PHASE_MODEL_FIELD = {
  PRIMARY: "primary",
  FALLBACK: "fallback",
} as const;

export type ProfilePhaseModelField = (typeof PROFILE_PHASE_MODEL_FIELD)[keyof typeof PROFILE_PHASE_MODEL_FIELD];

export type BulkProfileVersionOperation = BulkAssignmentOperation & {
  source: typeof PROFILE_VERSION_SOURCE.BULK;
  changedPhases?: number;
};

export type PhaseProfileVersionOperation = {
  source: typeof PROFILE_VERSION_SOURCE.PHASE;
  phase: string;
  field: ProfilePhaseModelField;
  modelId: string;
  changedPhases: 1;
};

export type ProfileVersionOperation = BulkProfileVersionOperation | PhaseProfileVersionOperation;

export type BulkProfilePhaseAssignmentResult = {
  profile: ProfileData;
  modelsAssigned: number;
  fallbackAssigned: number;
  changed: boolean;
};

export type ProfileVersionPreview = {
  models: ProfileModels;
  fallback: ProfileFallbackModels;
  configs?: ProfileConfigs;
};

export type ProfileVersion = {
  version: 1;
  id: string;
  profileFile: string;
  createdAt: string;
  source: ProfileVersionSource;
  operation: ProfileVersionOperation;
  operationSummary: string;
  beforeRaw: string;
  preview: ProfileVersionPreview;
};

export type UpdateProfilePhaseModelResult = {
  profile: ProfileData;
  changed: boolean;
  version?: ProfileVersion;
};

export type ProfileVersionMetadata = Omit<ProfileVersion, "beforeRaw">;

/**
 * Represents the persistent state of profiles
 */
export type ProfileState = {
  activeProfile?: string;
  updatedAt?: string;
};

/**
 * Represents an observation from the Engram memory system
 */
export type EngramObservation = {
  id: number;
  type: string;
  title?: string;
  topic_key?: string;
  content?: string;
  project: string;
  scope?: string;
  updated_at?: string;
  created_at?: string;
};

/**
 * Represents a selectable profile option in a menu
 */
export type ProfileOption = {
  title: string;
  value: string;
};

/**
 * Navigation separator category string
 */
export const NAV_CATEGORY = "─────────────";
