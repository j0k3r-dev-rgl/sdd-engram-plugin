/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * SDD Model Select Plugin Entry Point
 * 
 * This plugin allows users to manage and switch between different SDD profiles,
 * providing a visual badge for the active model and project-specific memory management.
 */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin";
import { createMemo, createEffect } from "solid-js";
import * as fs from "node:fs";
import { ActiveModelBadge } from "./components";

// Direct imports to avoid barrel resolution issues in some environments
import { activeProfile, setActiveProfile } from "./src/state";
import { resolvePaths } from "./src/config";
import { parseActiveProfileFromRaw, resolveSessionActiveModel } from "./src/utils";
import {
  showProfilesMenu,
  showProfileList,
  showProfileDetail,
  showProjectMemoriesMenu,
  registerDialogCallbacks,
} from "./src/dialogs";

// -- Plugin Initialization ---------------------------------------------------

/**
 * Initializes dialog callbacks to resolve circular dependencies between different UI views.
 */
function initializeDialogs() {
  registerDialogCallbacks({
    showProfilesMenu,
    showProfileList,
    showProfileDetail,
    showProjectMemoriesMenu,
  });
}

/**
 * Reads the currently active profile from the local configuration file.
 * 
 * @param api - The TUI API instance
 * @returns The active profile state or null if not found/invalid
 */
function readActiveProfile(api: any) {
  const { configPath } = resolvePaths();
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf-8");
    return parseActiveProfileFromRaw(raw, api);
  } catch {
    return null;
  }
}

function resolveDisplayedModel(api: any, sessionId?: string) {
  return resolveSessionActiveModel(api, sessionId) || activeProfile();
}

// -- Plugin Entry ------------------------------------------------------------

const id = "sdd-model-select";

/**
 * Main TUI plugin entry function
 * Registers commands and UI slots for the plugin
 */
const tui: TuiPlugin = async (api) => {
  // Initialize dialog callbacks
  initializeDialogs();

  // Load and set the active profile in the global state
  const profile = readActiveProfile(api);
  setActiveProfile(profile);

  // Keep the active profile in sync with global config changes
  createEffect(() => {
    const currentConfig = api.state.config;
    if (currentConfig) {
      setActiveProfile(parseActiveProfileFromRaw(JSON.stringify(currentConfig), api));
    }
  });

  // Register the main command
  api.command.register(() => [
    {
      title: "󰓅 SDD Profiles",
      value: "sdd-profiles",
      keybind: "alt+k,super+k",
      slash: { name: "sdd-model" },
      onSelect: () => showProfilesMenu(api),
    },
  ]);

  // Register UI slots - these use the global state directly for reactivity
  api.slots.register({
    slots: {
      home_bottom(ctx: any) {
        const profile = createMemo(() => {
          const route = api.route.current;
          const sessionId = route.name === "session" ? route.params?.sessionID : undefined;
          return resolveDisplayedModel(api, sessionId);
        });
        return <ActiveModelBadge profile={profile()} theme={ctx.theme.current} />;
      },
      sidebar_content(ctx: any) {
        const profile = createMemo(() => resolveDisplayedModel(api, ctx.session_id));
        return <ActiveModelBadge profile={profile()} theme={ctx.theme.current} />;
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = { id, tui };
export default plugin;
