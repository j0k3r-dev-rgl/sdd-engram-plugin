/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * SRC Module Barrel Exports
 * 
 * Consolidates and re-exports core functionality for easier access across the plugin.
 */

export * from "./types";
export * from "./utils";
export * from "./config";
export * from "./profiles";
export * from "./memories";
export * from "./state";
export * from "./orchestrator";
export {
  showProfilesMenu,
  showCreateProfile,
  showProfileList,
  showProfileDetail,
  showProjectMemoriesMenu,
  registerDialogCallbacks,
} from "./dialogs";
