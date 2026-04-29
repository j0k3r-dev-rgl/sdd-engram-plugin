/** @jsxImportSource @opentui/solid */
// @ts-nocheck

import { createSignal } from "solid-js";
import { ActiveProfileState } from "./types";

/**
 * The currently active profile state signal
 */
const [activeProfileSignal, setActiveProfileSignal] = createSignal<ActiveProfileState | null>(null);

/**
 * Getter for the active profile state
 */
export const activeProfile = activeProfileSignal;

/**
 * Updates the global active profile state
 * 
 * @param profile - The new profile state or null to clear it
 */
export function setActiveProfile(profile: ActiveProfileState | null): void {
  setActiveProfileSignal(profile);
}
