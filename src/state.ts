/** @jsxImportSource solid-js */
// @ts-nocheck

/**
 * Global Plugin State
 * 
 * Manages the active profile state shared across the plugin components.
 */

import { ActiveProfileState } from "./types";

/**
 * The currently active profile state
 */
export let activeProfile: ActiveProfileState | null = null;

/**
 * Updates the global active profile state
 * 
 * @param profile - The new profile state or null to clear it
 */
export function setActiveProfile(profile: ActiveProfileState | null): void {
  activeProfile = profile;
}
