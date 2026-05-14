/** @jsxImportSource @opentui/solid */
/**
 * SDD Model Select Plugin Entry Point
 *
 * This plugin allows users to manage and switch between different SDD profiles,
 * providing a visual badge for the active model and project-specific memory management.
 */

import * as fs from "node:fs";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { registerExCommands } from "@opentui/keymap/addons";
import { Show, createEffect, createRoot, untrack } from "solid-js";
import { ActiveModelBadge } from "./components";
import { resolvePaths } from "./src/config";
import {
	ACTIVE_PROFILE_NAME_KV_KEY,
	BADGE_DISPLAY_MODE_KV_KEY,
	BADGE_VISIBLE_KV_KEY,
	registerDialogCallbacks,
	showProfileDetail,
	showProfileList,
	showProfilesMenu,
	showProjectMemoriesMenu,
} from "./src/dialogs";
import { getHostVersion, safeSlotRender } from "./src/host-compat";
import { createLogger } from "./src/logger";
import { getOrchestratorPolicy } from "./src/orchestrator";
import { migrateProfilesForRuntimePolicy } from "./src/profiles";
// Direct imports to avoid barrel resolution issues in some environments
import {
	activeProfile,
	badgeDisplayMode,
	setActiveProfile,
	setBadgeDisplayMode,
	setShowModelBadge,
	showModelBadge,
} from "./src/state";
import type { BadgeDisplayMode } from "./src/types";
import {
	parseActiveProfileFromRaw,
	resolveSessionActiveModel,
} from "./src/utils";

// -- Plugin Initialization ---------------------------------------------------

const log = createLogger("tui");

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

async function readKv(api: any, key: string): Promise<unknown> {
	try {
		return await api?.kv?.get?.(key);
	} catch (error) {
		log.warn(`readKv: failed to read '${key}'`, error);
		return undefined;
	}
}

function isBadgeDisplayMode(value: unknown): value is BadgeDisplayMode {
	return value === "model" || value === "profile";
}

async function loadBadgePreferences(api: any): Promise<void> {
	const [visible, mode] = await Promise.all([
		readKv(api, BADGE_VISIBLE_KV_KEY),
		readKv(api, BADGE_DISPLAY_MODE_KV_KEY),
	]);
	const hidden = visible === false || visible === "false";
	setShowModelBadge(!hidden);
	setBadgeDisplayMode(isBadgeDisplayMode(mode) ? mode : "model");
}

async function readPersistedProfileName(api: any): Promise<string | undefined> {
	const value = await readKv(api, ACTIVE_PROFILE_NAME_KV_KEY);
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Reads the currently active profile from the local configuration file.
 *
 * @param api - The TUI API instance
 * @returns The active profile state or null if not found/invalid
 */
async function readActiveProfile(api: any) {
	const { configPath } = resolvePaths();
	try {
		if (!fs.existsSync(configPath)) return null;
		const raw = fs.readFileSync(configPath, "utf-8");
		const profile = parseActiveProfileFromRaw(raw, api);
		if (!profile) return null;
		const profileName = await readPersistedProfileName(api);
		return profileName ? { ...profile, profileName } : profile;
	} catch (error) {
		log.warn(`readActiveProfile: failed to read ${configPath}`, error);
		return null;
	}
}

function resolveDisplayedModel(api: any, sessionId?: string) {
	return resolveSessionActiveModel(api, sessionId) || activeProfile();
}

function openProfiles(api: any) {
	showProfilesMenu(api);
}

function registerProfilesCommand(api: any) {
	createRoot((disposeRoot) => {
		api.lifecycle.onDispose(disposeRoot);

		const disposeEx = registerExCommands(api.keymap);
		api.lifecycle.onDispose(disposeEx);

		const disposeLayer = api.keymap.registerLayer({
			priority: 100,
			commands: [
				{
					name: ":sdd-model",
					title: "󰓅 SDD Profiles",
					desc: "Manage SDD profiles",
					category: "SDD",
					nargs: "0",
					run: () => {
						openProfiles(api);
						return true;
					},
				},
			],
			bindings: [
				{ key: "alt+k", cmd: ":sdd-model" },
				{ key: "super+k", cmd: ":sdd-model" },
			],
		});
		api.lifecycle.onDispose(disposeLayer);

		if (api.command?.register) {
			const disposeLegacy = api.command.register(() => [
				{
					title: "󰓅 SDD Profiles",
					value: "sdd-model",
					description: "Manage SDD profiles",
					category: "SDD",
					slash: { name: "sdd-model" },
					onSelect: () => openProfiles(api),
				},
			]);
			api.lifecycle.onDispose(disposeLegacy);
		}
	});
}

function renderSlot(api: any, label: string, render: () => any) {
	return createRoot((dispose) => {
		api.lifecycle.onDispose(dispose);
		return safeSlotRender(label, render);
	});
}

function registerSlots(api: any) {
	createRoot((dispose) => {
		api.lifecycle.onDispose(dispose);

		api.slots.register({
			slots: {
				home_bottom(ctx: any) {
					return renderSlot(api, "home_bottom", () => {
						const route = api.route.current;
						const sessionId =
							route.name === "session" ? route.params?.sessionID : undefined;
						return (
							<Show when={showModelBadge()}>
								<ActiveModelBadge
									profile={resolveDisplayedModel(api, sessionId)}
									theme={ctx.theme.current}
									displayMode={badgeDisplayMode()}
								/>
							</Show>
						);
					});
				},
				sidebar_content(ctx: any) {
					return renderSlot(api, "sidebar_content", () => (
						<Show when={showModelBadge()}>
							<ActiveModelBadge
								profile={resolveDisplayedModel(api, ctx.session_id)}
								theme={ctx.theme.current}
								displayMode={badgeDisplayMode()}
							/>
						</Show>
					));
				},
			},
		});
	});
}

// -- Plugin Entry ------------------------------------------------------------

const id = "sdd-model-select";

/**
 * Main TUI plugin entry function
 * Registers commands and UI slots for the plugin
 */
const tui: TuiPlugin = async (api) => {
	log.info(`host opencode v${getHostVersion(api)}`);

	// Initialize dialog callbacks
	initializeDialogs();

	const runtimePolicy = getOrchestratorPolicy(
		Object.keys(api?.state?.config?.agent || {}),
		api?.state?.config?.default_agent,
	);
	migrateProfilesForRuntimePolicy(runtimePolicy);

	await loadBadgePreferences(api);

	// Load and set the active profile in the global state
	const profile = await readActiveProfile(api);
	setActiveProfile(profile);

	// Keep the active profile in sync with global config changes.
	createRoot((dispose) => {
		api.lifecycle.onDispose(dispose);
		createEffect(() => {
			const currentConfig = api.state.config;
			if (!currentConfig) return;
			const next = parseActiveProfileFromRaw(JSON.stringify(currentConfig), api);
			if (!next) {
				setActiveProfile(null);
				return;
			}
			const previousProfileName = untrack(() => activeProfile()?.profileName);
			setActiveProfile(
				previousProfileName ? { ...next, profileName: previousProfileName } : next,
			);
		});
	});

	// Register the main command using the current OpenCode TUI keymap API.
	registerProfilesCommand(api);

	// Register UI slots inside a Solid root because the host slot plugin creates cleanups.
	registerSlots(api);
};

const plugin: TuiPluginModule & { id: string } = { id, tui };
export default plugin;
