/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js";
import type { ActiveProfileState, BadgeDisplayMode } from "./types";

/**
 * The currently active profile state signal
 */
const [activeProfileSignal, setActiveProfileSignal] = createSignal<ActiveProfileState | null>(null);
const [showModelBadgeSignal, setShowModelBadgeSignal] = createSignal<boolean>(true);
const [badgeDisplayModeSignal, setBadgeDisplayModeSignal] = createSignal<BadgeDisplayMode>("model");

/**
 * Getter for the active profile state
 */
export const activeProfile = activeProfileSignal;
export const showModelBadge = showModelBadgeSignal;
export const badgeDisplayMode = badgeDisplayModeSignal;

/**
 * Updates the global active profile state
 *
 * @param profile - The new profile state or null to clear it
 */
export function setActiveProfile(profile: ActiveProfileState | null): void {
  setActiveProfileSignal(profile);
}

export function setShowModelBadge(value: boolean): void {
  setShowModelBadgeSignal(value);
}

export function setBadgeDisplayMode(mode: BadgeDisplayMode): void {
  setBadgeDisplayModeSignal(mode);
}
