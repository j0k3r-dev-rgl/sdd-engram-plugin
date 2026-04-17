/** @jsxImportSource solid-js */
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
};

/**
 * Mapping of profile names to their model identifiers
 */
export type ProfileModels = Record<string, string>;

/**
 * Mapping of fallback model overrides by base SDD agent name
 */
export type ProfileFallbackModels = Record<string, string>;

/**
 * Full profile payload persisted to disk
 */
export type ProfileData = {
  models: ProfileModels;
  fallback?: ProfileFallbackModels;
};

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
