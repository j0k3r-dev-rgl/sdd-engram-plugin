/** @jsxImportSource @opentui/solid */
// @ts-nocheck

/**
 * Plugin UI Dialogs
 * 
 * Contains all interactive dialogs for profile management, model selection,
 * and memory viewing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  BULK_ASSIGNMENT_MODE,
  BULK_ASSIGNMENT_TARGET,
  BulkAssignmentOperation,
  PROFILE_VERSION_SOURCE,
  ProfileVersion,
  ProfileVersionMetadata,
  NAV_CATEGORY,
} from "./types";
import {
  resolveModelInfo,
  formatMemoryDate,
  truncateText,
  parseActiveProfileFromRaw,
  formatContext,
  isFallbackEligibleSddAgent,
  isPrimarySddAgent,
} from "./utils";
import { resolvePaths, ensureProfilesDir, resolveProjectName } from "./config";
import {
  listProfileFiles,
  readProfileData,
  sanitizeProfileName,
  writeProfileData,
  writeProfileModels,
  updateProfileWithBulkPhaseAssignment,
  updateProfilePhaseModel,
  listProfileVersions,
  readProfileVersion,
  restoreProfileVersion,
  detectActiveProfileFile,
  activateProfileFile,
  deleteProfileFile,
  renameProfileFile,
} from "./profiles";
import { buildReasoningEditState, updateProfileReasoningEffort } from "./profile-reasoning";
import { deleteProjectMemory, listProjectMemories } from "./memories";
import { setActiveProfile } from "./state";
import { canonicalizeProfileModels, getOrchestratorPolicy, type OrchestratorPolicy } from "./orchestrator";

export function resolveRuntimeOrchestratorPolicy(config: any): OrchestratorPolicy {
  return getOrchestratorPolicy(
    Object.keys(config?.agent || {}),
    config?.default_agent
  );
}

export function buildProfileAgentRows(
  sddAgentNames: string[],
  profileData: any,
  policy: OrchestratorPolicy
): Array<{ title: string; value: string; modelId?: string }> {
  const models = canonicalizeProfileModels(profileData?.models || {}, policy);
  const canonicalNames = Array.from(new Set([...sddAgentNames, policy.canonicalName]));
  return canonicalNames
    .filter((name) => name !== "sdd-orchestrator" || policy.canonicalName === "sdd-orchestrator")
    .filter((name) => name !== "gentle-orchestrator" || policy.canonicalName === "gentle-orchestrator")
    .map((name) => ({ title: name, value: `model:${name}`, modelId: models[name] }));
}

export function buildReasoningRowForAgent(profileData: any, agentName: string): { title: string; value: string; description: string; category: string } {
  const saved = profileData?.configs?.[agentName]?.reasoningEffort;
  return {
    title: `${agentName} reasoning effort`,
    value: `reasoning:${agentName}`,
    description: saved ? `Saved: ${saved}` : "Unset",
    category: "Reasoning (PRIMARY SDD only)",
  };
}

export function buildReasoningBlockedMessage(state: any): string {
  if (state?.kind === "missing-model") return `Assign a primary model to ${state.agentName} before editing reasoning effort.`;
  if (state?.kind === "unsupported") return `Model ${state.modelId} does not expose reasoning effort options.`;
  return "Reasoning effort is not editable for this selection.";
}

export const PROFILE_DETAIL_SUBMENU = {
  PRIMARY: "__submenu_primary__",
  REASONING: "__submenu_reasoning__",
  FALLBACK: "__submenu_fallback__",
} as const;

export type ProfileDetailReturnTarget = "hub" | "primary" | "reasoning" | "fallback";

export function returnToProfileDetailTarget(
  api: any,
  profileOpt: any,
  returnTarget: ProfileDetailReturnTarget = "hub",
  deps?: any
) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const readProfile = deps?.readProfileData || readProfileData;
  const buildSections = deps?.buildProfileDetailAgentSections || buildProfileDetailAgentSections;
  const showPrimary = deps?.showProfileDetailSubmenuPrimary || showProfileDetailSubmenuPrimary;
  const showReasoning = deps?.showProfileDetailSubmenuReasoning || showProfileDetailSubmenuReasoning;
  const showFallback = deps?.showProfileDetailSubmenuFallback || showProfileDetailSubmenuFallback;

  if (returnTarget === "hub") {
    showHub(api, profileOpt);
    return;
  }

  try {
    const { profilesDir } = resolvePaths();
    const profilePath = path.join(profilesDir, profileOpt.value);
    const profileData = readProfile(profilePath);
    const sections = buildSections(api.state.config, profileData);

    if (returnTarget === "primary") showPrimary(api, profileOpt, profileData, sections);
    else if (returnTarget === "reasoning") showReasoning(api, profileOpt, profileData, sections);
    else showFallback(api, profileOpt, profileData, sections);
  } catch {
    showHub(api, profileOpt);
  }
}

export function resolveProfileDetailNavigationAction(optionValue: string):
  | { action: "submenu-primary" }
  | { action: "submenu-reasoning" }
  | { action: "submenu-fallback" }
  | { action: "back" }
  | { action: "selection" }
  | { action: "noop" } {
  if (!optionValue) return { action: "noop" };
  if (optionValue === PROFILE_DETAIL_SUBMENU.PRIMARY) return { action: "submenu-primary" };
  if (optionValue === PROFILE_DETAIL_SUBMENU.REASONING) return { action: "submenu-reasoning" };
  if (optionValue === PROFILE_DETAIL_SUBMENU.FALLBACK) return { action: "submenu-fallback" };
  if (optionValue === "__back__") return { action: "back" };
  if (optionValue.startsWith("__")) return { action: "noop" };
  if (
    optionValue.startsWith("model:")
    || optionValue.startsWith("reasoning:")
    || optionValue.startsWith("fallback:")
  ) {
    return { action: "selection" };
  }
  return { action: "noop" };
}

export function buildProfileDetailHubOptions(api: any, profileOpt: any, profileData: any) {
  const { sddAgents, fallbackAgents } = buildProfileDetailAgentSections(api.state.config, profileData);
  const reasoningSaved = sddAgents.filter(([name]) => Boolean(profileData?.configs?.[name]?.reasoningEffort)).length;
  const reasoningSummary = `${reasoningSaved}/${sddAgents.length} saved`;
  const fallbackConfigured = fallbackAgents.filter(([, modelId]) => Boolean(modelId)).length;
  const fallbackSummary = `${fallbackConfigured}/${fallbackAgents.length} configured`;

  return [
    { title: `✏ Name: ${profileOpt.title}`, value: "__rename__", category: "Profile" },
    {
      title: "Bulk actions...",
      value: "__bulk_actions__",
      description: "Fill or override primary and fallback SDD phase assignments",
      category: "Model Navigation",
    },
    ...sddAgents.map(([name, modelId]) => ({
      title: name,
      value: `model:${name}`,
      description: resolveModelInfo(api, modelId),
      category: "Model Navigation",
    })),
    {
      title: "Reasoning effort...",
      value: PROFILE_DETAIL_SUBMENU.REASONING,
      description: reasoningSummary,
      category: "Model Navigation",
    },
    {
      title: "Fallback models...",
      value: PROFILE_DETAIL_SUBMENU.FALLBACK,
      description: fallbackSummary,
      category: "Model Navigation",
    },
    {
      title: "Profile versions...",
      value: "__profile_versions__",
      description: "Preview and restore previous profile versions",
      category: "Agents",
    },
    { title: "✓ Activate Profile", value: "__assign__", category: NAV_CATEGORY },
    { title: "✕ Delete Profile", value: "__delete__", category: NAV_CATEGORY },
    { title: "← Back", value: "__back__", category: NAV_CATEGORY },
  ];
}

export function resolveProfileDetailSelectionAction(optionValue: string):
  | { action: "model"; agentName: string }
  | { action: "reasoning"; agentName: string }
  | { action: "fallback"; agentName: string }
  | { action: "noop" } {
  if (!optionValue || optionValue.startsWith("__")) return { action: "noop" };
  if (optionValue.startsWith("model:")) return { action: "model", agentName: optionValue.replace("model:", "") };
  if (optionValue.startsWith("reasoning:")) return { action: "reasoning", agentName: optionValue.replace("reasoning:", "") };
  if (optionValue.startsWith("fallback:")) return { action: "fallback", agentName: optionValue.replace("fallback:", "") };
  return { action: "noop" };
}

export function buildProfileDetailAgentSections(
  config: any,
  profileData: any
): {
  sddAgentNames: string[];
  sddAgents: Array<[string, string | undefined]>;
  fallbackAgents: Array<[string, string | undefined]>;
  policy: OrchestratorPolicy;
} {
  const sddAgentNames = Object.keys(config?.agent || {})
    .filter(isPrimarySddAgent)
    .sort();
  const policy = resolveRuntimeOrchestratorPolicy(config);
  const sddAgents = buildProfileAgentRows(sddAgentNames, profileData, policy)
    .map((row) => [row.title, row.modelId] as [string, string | undefined]);
  const fallbackModelMap = profileData?.fallback || {};
  const fallbackAgents = sddAgentNames
    .filter((name) => isFallbackEligibleSddAgent(name))
    .map((name) => [name, fallbackModelMap[name]] as [string, string | undefined]);

  return { sddAgentNames, sddAgents, fallbackAgents, policy };
}

export function buildPrimaryModelSubmenuOptions(profileData: any, sections: any, api?: any) {
  return [
    ...sections.sddAgents.map(([name, modelId]: [string, string | undefined]) => ({
      title: name,
      value: `model:${name}`,
      description: api ? resolveModelInfo(api, modelId) : (modelId || "Unset"),
      category: "Primary Models",
    })),
    { title: "← Back", value: "__back__", category: NAV_CATEGORY },
  ];
}

export function buildReasoningSubmenuOptions(profileData: any, sections: any) {
  return [
    ...sections.sddAgents.map(([name]: [string, string | undefined]) => buildReasoningRowForAgent(profileData, name)),
    { title: "← Back", value: "__back__", category: NAV_CATEGORY },
  ];
}

export function buildFallbackSubmenuOptions(profileData: any, sections: any, api?: any) {
  return [
    ...sections.fallbackAgents.map(([name, modelId]: [string, string | undefined]) => ({
      title: `${name} -> ${name}-fallback`,
      value: `fallback:${name}`,
      description: modelId ? (api ? resolveModelInfo(api, modelId) : modelId) : "Inherited from base model",
      category: "Fallback Models",
    })),
    { title: "← Back", value: "__back__", category: NAV_CATEGORY },
  ];
}

/**
 * Displays a detailed view of a specific memory observation
 * 
 * @param api - The TUI API instance
 * @param memory - The memory object to display
 */
function showMemoryDetail(api: any, memory: any) {
  /**
   * Cleans text for better display in the TUI
   */
  const sanitizeMemoryDisplayText = (value: string): string =>
    value
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/→/g, "->");

  /**
   * Wraps long text lines to fit within the dialog width
   */
  const wrapDisplayText = (value: string, max = 52): string[] => {
    if (!value) return [" "];
    const words = sanitizeMemoryDisplayText(value).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [" "];

    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }

      if (`${current} ${word}`.length <= max) {
        current = `${current} ${word}`;
        continue;
      }

      lines.push(current);
      current = word;
    }

    if (current) lines.push(current);
    return lines.length > 0 ? lines : [value];
  };

  const title = memory.title || memory.topic_key || `Memory #${memory.id}`;
  const metadata = `[${(memory.type || "manual").toUpperCase()}] ${formatMemoryDate(
    memory.updated_at || memory.created_at
  )} · ${memory.scope || "project"}`;
  const contentLines = (memory.content || "No content")
    .split("\n")
    .flatMap((line: string) => wrapDisplayText(line || " "));

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={truncateText(title, 60)}
      options={[
        {
          title: metadata,
          value: "__meta__",
          category: "Memory",
        },
        ...contentLines.map((line: string, index: number) => ({
          title: line || " ",
          value: `__line__${index}`,
        })),
        { title: "✕ Delete Memory", value: "__delete__", category: NAV_CATEGORY },
        { title: "← Back", value: "__back__", category: NAV_CATEGORY },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProjectMemoriesMenuFn(api);
        else if (opt.value === "__delete__") showDeleteMemory(api, memory);
        else showMemoryDetail(api, memory);
      }}
      onCancel={() => showProjectMemoriesMenuFn(api)}
    />
  ));
}

/**
 * Displays a confirmation dialog before deleting a memory
 * 
 * @param api - The TUI API instance
 * @param memory - The memory object to delete
 */
function showDeleteMemory(api: any, memory: any) {
  const title = memory.title || memory.topic_key || `Memory #${memory.id}`;

  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Delete Memory"
      message={`Permanently delete '${truncateText(title, 48)}'?`}
      onConfirm={async () => {
        try {
          await deleteProjectMemory(memory.id);
          api.ui.toast({ title: "Deleted", message: "Memory deleted successfully", variant: "success" });
          showProjectMemoriesMenuFn(api);
        } catch (e: any) {
          api.ui.toast({ title: "Error", message: e.message || "Failed to delete memory", variant: "error" });
          showMemoryDetail(api, memory);
        }
      }}
      onCancel={() => showMemoryDetail(api, memory)}
    />
  ));
}

// Internal function references to resolve circular dependencies between dialogs
let showProfilesMenuFn: (api: any) => void | Promise<void>;
let showProfileListFn: (api: any) => void | Promise<void>;
let showProfileDetailFn: (api: any, profileOpt: any) => void | Promise<void>;
let showProjectMemoriesMenuFn: (api: any) => void | Promise<void>;

export type BulkProfileActionOption = {
  title: string;
  value: string;
  operation: BulkAssignmentOperation;
  requiresConfirmation: boolean;
};

export function buildBulkProfileActionOptions(): BulkProfileActionOption[] {
  return [
    {
      title: "Set all primary phases",
      value: "bulk:fill-only:primary",
      operation: { target: BULK_ASSIGNMENT_TARGET.PRIMARY, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
      requiresConfirmation: false,
    },
    {
      title: "Set all fallback phases",
      value: "bulk:fill-only:fallback",
      operation: { target: BULK_ASSIGNMENT_TARGET.FALLBACK, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
      requiresConfirmation: false,
    },
    {
      title: "Set all phases and fallbacks",
      value: "bulk:fill-only:both",
      operation: { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
      requiresConfirmation: false,
    },
    {
      title: "Override all primary phases",
      value: "bulk:overwrite:primary",
      operation: { target: BULK_ASSIGNMENT_TARGET.PRIMARY, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
      requiresConfirmation: true,
    },
    {
      title: "Override all fallback phases",
      value: "bulk:overwrite:fallback",
      operation: { target: BULK_ASSIGNMENT_TARGET.FALLBACK, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
      requiresConfirmation: true,
    },
    {
      title: "Override all phases and fallbacks",
      value: "bulk:overwrite:both",
      operation: { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
      requiresConfirmation: true,
    },
  ];
}

export function formatProfileVersionPreviewLines(version: ProfileVersion): string[] {
  const primaryLines = Object.entries(version.preview.models || {}).map(([name, model]) => `Primary: ${name} -> ${model}`);
  const fallbackLines = Object.entries(version.preview.fallback || {}).map(([name, model]) => `Fallback: ${name} -> ${model}`);
  return [
    `Profile: ${version.profileFile}`,
    `Created: ${formatMemoryDate(version.createdAt)}`,
    `Source: ${formatProfileVersionSource(version.source)}`,
    `Operation: ${version.operationSummary}`,
    ...(primaryLines.length > 0 ? primaryLines : ["Primary: none"]),
    ...(fallbackLines.length > 0 ? fallbackLines : ["Fallback: none"]),
    `Raw: ${truncateText(version.beforeRaw.replace(/\s+/g, " "), 80)}`,
  ];
}

function formatProfileVersionSource(source: string | undefined): string {
  return source === PROFILE_VERSION_SOURCE.PHASE ? "Phase" : "Bulk";
}

export function buildProfileVersionListOption(version: ProfileVersionMetadata): { title: string; value: string; description: string } {
  return {
    title: `${formatMemoryDate(version.createdAt)} · ${formatProfileVersionSource(version.source)}`,
    value: version.id,
    description: version.operationSummary,
  };
}

/**
 * Registers callback functions for cross-dialog navigation
 * 
 * @param callbacks - Collection of dialog functions
 */
export function registerDialogCallbacks(callbacks: {
  showProfilesMenu: (api: any) => void | Promise<void>;
  showProfileList: (api: any) => void | Promise<void>;
  showProfileDetail: (api: any, profileOpt: any) => void | Promise<void>;
  showProjectMemoriesMenu: (api: any) => void | Promise<void>;
}) {
  showProfilesMenuFn = callbacks.showProfilesMenu;
  showProfileListFn = callbacks.showProfileList;
  showProfileDetailFn = callbacks.showProfileDetail;
  showProjectMemoriesMenuFn = callbacks.showProjectMemoriesMenu;
}

/**
 * Displays the main SDD Profiles management menu
 * 
 * @param api - The TUI API instance
 */
export function showProfilesMenu(api: any) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="SDD Profile Management"
      options={[
        {
          title: "󰏪 Create New SDD Profile",
          value: "create",
          description: "Create an empty SDD profile for manual configuration.",
        },
        {
          title: "󰓅 Manage SDD Profiles",
          value: "list",
          description: "List and activate your saved SDD profiles.",
        },
        {
          title: "󰄄 View Project Memories",
          value: "view_memories",
          description: "Show recent Engram observations for this project.",
        },
        {
          title: "✕ Close",
          value: "__close__",
          category: NAV_CATEGORY,
        },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "create") showCreateProfile(api);
        else if (opt.value === "list") showProfileListFn(api);
        else if (opt.value === "view_memories") showProjectMemoriesMenuFn(api);
        else api.ui.dialog.clear();
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ));
}

/**
 * Displays a prompt to create a new profile from the current configuration
 * 
 * @param api - The TUI API instance
 */
export function showCreateProfile(api: any) {
  const { configPath, profilesDir } = resolvePaths();
  ensureProfilesDir();

  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="New SDD Profile Name"
      placeholder="Enter profile name"
      onConfirm={(name: string) => {
        const trimmed = name?.trim();
        if (!trimmed) {
          showProfilesMenuFn(api);
          return;
        }

        try {
          const finalName = sanitizeProfileName(trimmed);
          const fileName = `${finalName}.json`;
          const profilePath = path.join(profilesDir, fileName);

          if (fs.existsSync(profilePath)) {
            api.ui.toast({
              title: "Error",
              message: `Profile '${finalName}' already exists`,
              variant: "error",
            });
            showProfilesMenuFn(api);
            return;
          }

          writeProfileModels(profilePath, {});
          
          // Defer both navigation and toast to next tick to ensure the current 
          // DialogPrompt has fully finished its state cycle, avoiding races 
          // that could prevent the new detail view from appearing reliably.
          setTimeout(() => {
            showProfileDetailFn(api, { title: finalName, value: fileName });
            api.ui.toast({
              title: "Success",
              message: `Profile '${finalName}' created successfully`,
              variant: "success",
            });
          }, 0);
        } catch (e: any) {
          api.ui.toast({
            title: "Error",
            message: `Failed to create profile: ${e.message}`,
            variant: "error",
          });
          showProfilesMenuFn(api);
        }
      }}
      onCancel={() => showProfilesMenuFn(api)}
    />
  ));
}

/**
 * Displays a list of all saved SDD profiles for selection
 * 
 * @param api - The TUI API instance
 */
export function showProfileList(api: any) {
  ensureProfilesDir();

  const files = listProfileFiles();

  if (files.length === 0) {
    api.ui.toast({
      title: "No Profiles",
      message: "No saved profiles found. Create one first!",
      variant: "warning",
    });
    showProfilesMenuFn(api);
    return;
  }

  const activeFile = detectActiveProfileFile(files, api);

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Select SDD Profile"
      current={activeFile}
      options={[
        ...files.map((f) => ({
          title: `${f === activeFile ? "✓ " : ""}${f.replace(".json", "")}`,
          value: f,
          description: f === activeFile ? "✓ Active" : "SDD Profile",
        })),
        { title: "← Back", value: "__back__", category: NAV_CATEGORY },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProfilesMenuFn(api);
        else showProfileDetailFn(api, { title: String(opt.value).replace(".json", ""), value: opt.value });
      }}
      onCancel={() => showProfilesMenuFn(api)}
    />
  ));
}

/**
 * Displays detailed information and management options for a specific profile
 * 
 * @param api - The TUI API instance
 * @param profileOpt - Selected profile option containing title and value (filename)
 */
export function showProfileDetail(api: any, profileOpt: any) {
  const { profilesDir } = resolvePaths();
  try {
    const profilePath = path.join(profilesDir, profileOpt.value);
    const profileData = readProfileData(profilePath);
    const sections = buildProfileDetailAgentSections(api.state.config, profileData);
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        {...createProfileDetailDialogProps(api, profileOpt, profilePath, profileData, sections)}
      />
    ));
  } catch (e) {
    api.ui.toast({ title: "Error", message: "Failed to read profile details", variant: "error" });
  }
}

export function createProfileDetailDialogProps(
  api: any,
  profileOpt: any,
  profilePath: string,
  profileData: any,
  sections: any,
  deps?: any,
) {
  const showProfileList = deps?.showProfileList || showProfileListFn;
  const activateProfile = deps?.handleActivateProfile || handleActivateProfile;
  const showDelete = deps?.showDeleteProfile || showDeleteProfile;
  const showRename = deps?.showRenameProfile || showRenameProfile;
  const showBulk = deps?.showBulkProfileActions || showBulkProfileActions;
  const showVersions = deps?.showProfileVersions || showProfileVersions;
  const showPrimarySubmenu = deps?.showProfileDetailSubmenuPrimary || showProfileDetailSubmenuPrimary;
  const showReasoningSubmenu = deps?.showProfileDetailSubmenuReasoning || showProfileDetailSubmenuReasoning;
  const showFallbackSubmenu = deps?.showProfileDetailSubmenuFallback || showProfileDetailSubmenuFallback;
  const showProvider = deps?.showProviderPickerForAgent || showProviderPickerForAgent;
  const showReasoning = deps?.showReasoningEffortPicker || showReasoningEffortPicker;

  return {
    title: `Profile: ${profileOpt.title}`,
    options: buildProfileDetailHubOptions(api, profileOpt, profileData),
    onSelect: (opt: any) => {
      if (opt.value === "__back__") showProfileList(api);
      else if (opt.value === "__assign__") activateProfile(api, profilePath, profileOpt.title);
      else if (opt.value === "__delete__") showDelete(api, profileOpt);
      else if (opt.value === "__rename__") showRename(api, profileOpt);
      else if (opt.value === "__bulk_actions__") showBulk(api, profileOpt);
      else if (opt.value === "__profile_versions__") showVersions(api, profileOpt);
      else {
        const navAction = resolveProfileDetailNavigationAction(opt.value);
        if (navAction.action === "submenu-primary") {
          showPrimarySubmenu(api, profileOpt, profileData, sections);
          return;
        }
        if (navAction.action === "submenu-reasoning") {
          showReasoningSubmenu(api, profileOpt, profileData, sections);
          return;
        }
        if (navAction.action === "submenu-fallback") {
          showFallbackSubmenu(api, profileOpt, profileData, sections);
          return;
        }

        const selectionAction = resolveProfileDetailSelectionAction(opt.value);
        if (selectionAction.action === "model") {
          showProvider(api, profileOpt, selectionAction.agentName, "model", "hub");
        } else if (selectionAction.action === "reasoning") {
          showReasoning(api, profileOpt, selectionAction.agentName, "hub");
        } else if (selectionAction.action === "fallback") {
          showProvider(api, profileOpt, selectionAction.agentName, "fallback", "hub");
        }
      }
    },
    onCancel: () => showProfileList(api),
  };
}

function showProfileDetailSubmenuPrimary(api: any, profileOpt: any, profileData: any, sections?: any) {
  const resolvedSections = sections || buildProfileDetailAgentSections(api.state.config, profileData);
  api.ui.dialog.replace(() => (<api.ui.DialogSelect {...createPrimarySubmenuDialogProps(api, profileOpt, profileData, resolvedSections)} />));
}

function showProfileDetailSubmenuReasoning(api: any, profileOpt: any, profileData: any, sections?: any) {
  const resolvedSections = sections || buildProfileDetailAgentSections(api.state.config, profileData);
  api.ui.dialog.replace(() => (<api.ui.DialogSelect {...createReasoningSubmenuDialogProps(api, profileOpt, profileData, resolvedSections)} />));
}

function showProfileDetailSubmenuFallback(api: any, profileOpt: any, profileData: any, sections?: any) {
  const resolvedSections = sections || buildProfileDetailAgentSections(api.state.config, profileData);
  api.ui.dialog.replace(() => (<api.ui.DialogSelect {...createFallbackSubmenuDialogProps(api, profileOpt, profileData, resolvedSections)} />));
}

export function createPrimarySubmenuDialogProps(api: any, profileOpt: any, profileData: any, sections: any, deps?: any) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const showProvider = deps?.showProviderPickerForAgent || showProviderPickerForAgent;
  return {
    title: `Primary models › ${profileOpt.title}`,
    options: buildPrimaryModelSubmenuOptions(profileData, sections, api),
    onSelect: (opt: any) => {
        if (opt.value === "__back__") showHub(api, profileOpt);
        else {
          const nextAction = resolveProfileDetailSelectionAction(opt.value);
        if (nextAction.action === "model") showProvider(api, profileOpt, nextAction.agentName, "model", "primary");
      }
    },
    onCancel: () => showHub(api, profileOpt),
  };
}

export function createReasoningSubmenuDialogProps(api: any, profileOpt: any, profileData: any, sections: any, deps?: any) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const showReasoning = deps?.showReasoningEffortPicker || showReasoningEffortPicker;
  return {
    title: `Reasoning effort › ${profileOpt.title}`,
    options: buildReasoningSubmenuOptions(profileData, sections),
    onSelect: (opt: any) => {
        if (opt.value === "__back__") showHub(api, profileOpt);
        else {
          const nextAction = resolveProfileDetailSelectionAction(opt.value);
        if (nextAction.action === "reasoning") showReasoning(api, profileOpt, nextAction.agentName, "reasoning");
      }
    },
    onCancel: () => showHub(api, profileOpt),
  };
}

export function createFallbackSubmenuDialogProps(api: any, profileOpt: any, profileData: any, sections: any, deps?: any) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const showProvider = deps?.showProviderPickerForAgent || showProviderPickerForAgent;
  return {
    title: `Fallback models › ${profileOpt.title}`,
    options: buildFallbackSubmenuOptions(profileData, sections, api),
    onSelect: (opt: any) => {
        if (opt.value === "__back__") showHub(api, profileOpt);
        else {
          const nextAction = resolveProfileDetailSelectionAction(opt.value);
        if (nextAction.action === "fallback") showProvider(api, profileOpt, nextAction.agentName, "fallback", "fallback");
      }
    },
    onCancel: () => showHub(api, profileOpt),
  };
}

function showReasoningEffortPicker(api: any, profileOpt: any, agentName: string, returnTarget: ProfileDetailReturnTarget = "hub") {
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, profileOpt.value);

  try {
    const profile = readProfileData(profilePath);
    const modelId = profile?.models?.[agentName];
    const current = profile?.configs?.[agentName]?.reasoningEffort;
    const state = buildReasoningEditState(api?.state?.provider || [], agentName, modelId, current);

    if (state.kind !== "selectable") {
      api.ui.toast({ title: "Reasoning Unsupported", message: buildReasoningBlockedMessage(state), variant: "warning" });
      returnToProfileDetailTarget(api, profileOpt, returnTarget);
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Reasoning effort › ${agentName}`}
        options={[
          ...state.options.map((value: string) => ({
            title: value,
            value,
            description: state.current === value ? "Current" : undefined,
          })),
          { title: "Clear saved value", value: "__clear__", category: NAV_CATEGORY },
          { title: "← Back", value: "__back__", category: NAV_CATEGORY },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") {
            returnToProfileDetailTarget(api, profileOpt, returnTarget);
            return;
          }

          const nextProfile = updateProfileReasoningEffort(profile, agentName, opt.value === "__clear__" ? "" : opt.value);
          writeProfileData(profilePath, nextProfile, resolveRuntimeOrchestratorPolicy(api.state.config));
          api.ui.toast({ title: "Updated", message: `${agentName} reasoning effort updated`, variant: "success" });
          returnToProfileDetailTarget(api, profileOpt, returnTarget);
        }}
        onCancel={() => returnToProfileDetailTarget(api, profileOpt, returnTarget)}
      />
    ));
  } catch (e: any) {
    api.ui.toast({ title: "Error", message: `Failed to update reasoning effort: ${e.message}`, variant: "error" });
    returnToProfileDetailTarget(api, profileOpt, returnTarget);
  }
}

/**
 * Handles the activation of a profile and updates global state
 */
async function handleActivateProfile(api: any, profilePath: string, profileName: string) {
  const updatedConfig = await activateProfileFile(api, profilePath, profileName);
  if (!updatedConfig) return;

  // Sync global state after activation
  setActiveProfile(parseActiveProfileFromRaw(JSON.stringify(updatedConfig), api));

  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Profile Activated"
      message={`Profile '${profileName}' successfully applied to global configuration.`}
      onConfirm={() => api.ui.dialog.clear()}
      onCancel={() => api.ui.dialog.clear()}
    />
  ));
}

/**
 * Displays a confirmation dialog before deleting a profile
 */
function showDeleteProfile(api: any, profileOpt: any) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Delete Profile"
      message={`Permanently delete '${profileOpt.title}'?`}
      onConfirm={() => {
        try {
          deleteProfileFile(profileOpt.value);
          api.ui.toast({ title: "Deleted", message: `Profile '${profileOpt.title}' deleted` });
          showProfileListFn(api);
        } catch (e: any) {
          api.ui.toast({ title: "Error", message: `Failed to delete: ${e.message}`, variant: "error" });
          showProfileDetailFn(api, profileOpt);
        }
      }}
      onCancel={() => showProfileDetailFn(api, profileOpt)}
    />
  ));
}

/**
 * Displays a prompt to rename an existing profile
 */
function showRenameProfile(api: any, profileOpt: any) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Rename Profile"
      value={profileOpt.title}
      onConfirm={(newName: string) => {
        const trimmed = newName?.trim();
        if (!trimmed || trimmed === profileOpt.title) {
          showProfileDetailFn(api, profileOpt);
          return;
        }

        try {
          const finalName = sanitizeProfileName(trimmed);
          const newFileName = `${finalName}.json`;

          const { profilesDir } = resolvePaths();
          const newPath = path.join(profilesDir, newFileName);

          if (fs.existsSync(newPath)) {
            api.ui.toast({ title: "Error", message: "A profile with this name already exists", variant: "error" });
            showProfileDetailFn(api, profileOpt);
            return;
          }

          renameProfileFile(profileOpt.value, newFileName);
          api.ui.toast({ title: "Renamed", message: `Profile renamed to '${finalName}'` });
          showProfileListFn(api);
        } catch (e: any) {
          api.ui.toast({ title: "Error", message: `Failed to rename: ${e.message}`, variant: "error" });
          showProfileDetailFn(api, profileOpt);
        }
      }}
      onCancel={() => showProfileDetailFn(api, profileOpt)}
    />
  ));
}

/**
 * Displays bulk assignment actions for the selected profile.
 */
function showBulkProfileActions(api: any, profileOpt: any) {
  const options = buildBulkProfileActionOptions();

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Bulk profile actions"
      options={[
        ...options.map((option) => ({
          title: option.title,
          value: option.value,
          description: option.requiresConfirmation ? "Requires confirmation before overwriting" : "Fill only empty or unassigned entries",
        })),
        { title: "← Back", value: "__back__", category: NAV_CATEGORY },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProfileDetailFn(api, profileOpt);
        else {
          const selected = options.find((option) => option.value === opt.value);
          if (!selected) return;
          if (selected.requiresConfirmation) showConfirmBulkProfileOverride(api, profileOpt, selected);
          else showProviderPickerForBulkProfilePhases(api, profileOpt, selected);
        }
      }}
      onCancel={() => showProfileDetailFn(api, profileOpt)}
    />
  ));
}

function showConfirmBulkProfileOverride(api: any, profileOpt: any, action: BulkProfileActionOption) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Confirm bulk override"
      message={`${action.title} will replace existing targeted assignments in '${profileOpt.title}'. A dated version will be saved first.`}
      onConfirm={() => showProviderPickerForBulkProfilePhases(api, profileOpt, action)}
      onCancel={() => showBulkProfileActions(api, profileOpt)}
    />
  ));
}

/**
 * Displays a menu to select a provider for bulk phase assignment.
 */
function showProviderPickerForBulkProfilePhases(api: any, profileOpt: any, action: BulkProfileActionOption) {
  const providers = (api.state.provider || []).filter((p: any) => Object.keys(p.models || {}).length > 0);

  if (providers.length === 0) {
    api.ui.toast({ title: "No Providers", message: "No authenticated providers found.", variant: "warning" });
    showBulkProfileActions(api, profileOpt);
    return;
  }

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`Provider › ${action.title}`}
      options={[
        ...providers.map((p: any) => ({
          title: p.name || p.id,
          value: p.id,
          description: `${Object.keys(p.models || {}).length} models available`,
        })),
        { title: "← Back", value: "__back__", category: NAV_CATEGORY },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showBulkProfileActions(api, profileOpt);
        else {
          const selected = providers.find((p: any) => p.id === opt.value);
          showModelPickerForBulkProfilePhases(api, profileOpt, selected, action);
        }
      }}
      onCancel={() => showBulkProfileActions(api, profileOpt)}
    />
  ));
}

/**
 * Displays a model picker for bulk phase assignment.
 */
function showModelPickerForBulkProfilePhases(api: any, profileOpt: any, provider: any, action: BulkProfileActionOption) {
  const models = provider.models || {};
  const modelKeys = Object.keys(models);

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`${provider.name || provider.id} › ${action.title}`}
      options={[
        ...modelKeys.map((key) => {
          const model = models[key];
          const ctxText = model.limit?.context ? formatContext(model.limit.context) : "ctx: N/A";
          return {
            title: model.name || key,
            value: `${provider.id}/${key}`,
            description: ctxText,
          };
        }),
        { title: "← Back", value: "__back__", category: NAV_CATEGORY },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProviderPickerForBulkProfilePhases(api, profileOpt, action);
        else updateBulkProfilePhases(api, profileOpt, opt.value, action);
      }}
      onCancel={() => showProviderPickerForBulkProfilePhases(api, profileOpt, action)}
    />
  ));
}

/**
 * Assigns the selected model to targeted SDD profile phases and versions before mutation.
 */
function updateBulkProfilePhases(api: any, profileOpt: any, fullModelId: string, action: BulkProfileActionOption) {
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, profileOpt.value);

  try {
    const primarySddAgentNames = Object.keys(api.state.config?.agent || {}).filter(isPrimarySddAgent);
    const runtimePolicy = resolveRuntimeOrchestratorPolicy(api.state.config);
    const { assignment } = updateProfileWithBulkPhaseAssignment(profilePath, primarySddAgentNames, fullModelId, action.operation, runtimePolicy);

    const totalAssigned = assignment.modelsAssigned + assignment.fallbackAssigned;
    api.ui.toast({
      title: totalAssigned > 0 ? "Updated" : "No Changes",
      message:
        totalAssigned > 0
          ? `${action.title}: ${assignment.modelsAssigned} primary and ${assignment.fallbackAssigned} fallback assignments set to ${fullModelId}. Version saved.`
          : "No targeted SDD primary or fallback phases required updates",
      variant: totalAssigned > 0 ? "success" : "warning",
    });
    showProfileDetailFn(api, profileOpt);
  } catch (e: any) {
    api.ui.toast({ title: "Error", message: `Failed to update phases: ${e.message}`, variant: "error" });
    showProfileDetailFn(api, profileOpt);
  }
}

function showProfileVersions(api: any, profileOpt: any) {
  try {
    const versions = listProfileVersions(profileOpt.value);

    if (versions.length === 0) {
      api.ui.toast({ title: "No Versions", message: `No saved versions for '${profileOpt.title}'`, variant: "warning" });
      showProfileDetailFn(api, profileOpt);
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Versions: ${profileOpt.title}`}
        options={[
          ...versions.map(buildProfileVersionListOption),
          { title: "← Back", value: "__back__", category: NAV_CATEGORY },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") showProfileDetailFn(api, profileOpt);
          else showProfileVersionPreview(api, profileOpt, opt.value);
        }}
        onCancel={() => showProfileDetailFn(api, profileOpt)}
      />
    ));
  } catch (e: any) {
    api.ui.toast({ title: "Version Error", message: e.message || "Failed to list profile versions", variant: "error" });
    showProfileDetailFn(api, profileOpt);
  }
}

function showProfileVersionPreview(api: any, profileOpt: any, versionId: string) {
  try {
    const version = readProfileVersion(versionId);
    const lines = formatProfileVersionPreviewLines(version);

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Preview: ${profileOpt.title}`}
        options={[
          ...lines.map((line, index) => ({ title: line, value: `__line__${index}` })),
          { title: "↩ Restore this version", value: "__restore__", category: NAV_CATEGORY },
          { title: "← Back", value: "__back__", category: NAV_CATEGORY },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__restore__") showConfirmRestoreProfileVersion(api, profileOpt, version.id);
          else if (opt.value === "__back__") showProfileVersions(api, profileOpt);
          else showProfileVersionPreview(api, profileOpt, versionId);
        }}
        onCancel={() => showProfileVersions(api, profileOpt)}
      />
    ));
  } catch (e: any) {
    api.ui.toast({ title: "Version Error", message: e.message || "Failed to read profile version", variant: "error" });
    showProfileVersions(api, profileOpt);
  }
}

function showConfirmRestoreProfileVersion(api: any, profileOpt: any, versionId: string) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Restore profile version"
      message={`Restore '${profileOpt.title}' from this version? Current profile content will be overwritten.`}
      onConfirm={() => {
        try {
          restoreProfileVersion(profileOpt.value, versionId);
          api.ui.toast({ title: "Restored", message: `Profile '${profileOpt.title}' restored`, variant: "success" });
          showProfileDetailFn(api, profileOpt);
        } catch (e: any) {
          api.ui.toast({ title: "Restore Failed", message: e.message || "Failed to restore version", variant: "error" });
          showProfileVersionPreview(api, profileOpt, versionId);
        }
      }}
      onCancel={() => showProfileVersionPreview(api, profileOpt, versionId)}
    />
  ));
}

/**
 * Displays a menu to select a provider for a specific agent in the profile
 */
function showProviderPickerForAgent(
  api: any,
  profileOpt: any,
  agentName: string,
  mode: "model" | "fallback",
  returnTarget: ProfileDetailReturnTarget = "hub"
) {
  const providers = (api.state.provider || []).filter((p: any) => Object.keys(p.models || {}).length > 0);

  if (providers.length === 0) {
    api.ui.toast({ title: "No Providers", message: "No authenticated providers found.", variant: "warning" });
    returnToProfileDetailTarget(api, profileOpt, returnTarget);
    return;
  }

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`Provider for ${agentName}${mode === "fallback" ? " (fallback)" : ""}`}
      options={[
        ...providers.map((p: any) => ({
          title: p.name || p.id,
          value: p.id,
          description: `${Object.keys(p.models || {}).length} models available`,
        })),
        { title: "← Back", value: "__back__", category: NAV_CATEGORY },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") returnToProfileDetailTarget(api, profileOpt, returnTarget);
        else {
          const selected = providers.find((p: any) => p.id === opt.value);
          showModelPickerForAgent(api, profileOpt, agentName, selected, mode, returnTarget);
        }
      }}
      onCancel={() => returnToProfileDetailTarget(api, profileOpt, returnTarget)}
    />
  ));
}

/**
 * Displays a menu to select a model from a provider for a specific agent
 */
function showModelPickerForAgent(
  api: any,
  profileOpt: any,
  agentName: string,
  provider: any,
  mode: "model" | "fallback",
  returnTarget: ProfileDetailReturnTarget = "hub"
) {
  const models = provider.models || {};
  const modelKeys = Object.keys(models);

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`${provider.name || provider.id} › ${agentName}${mode === "fallback" ? " (fallback)" : ""}`}
      options={[
        ...modelKeys.map((key) => {
          const model = models[key];
          const ctxText = model.limit?.context ? formatContext(model.limit.context) : "ctx: N/A";
          return {
            title: model.name || key,
            value: `${provider.id}/${key}`,
            description: ctxText,
          };
        }),
        { title: "← Back", value: "__back__", category: NAV_CATEGORY },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProviderPickerForAgent(api, profileOpt, agentName, mode, returnTarget);
        else updateAgentModel(api, profileOpt, agentName, opt.value, mode, returnTarget);
      }}
      onCancel={() => showProviderPickerForAgent(api, profileOpt, agentName, mode, returnTarget)}
    />
  ));
}

/**
 * Updates a specific agent's model within a profile file
 */
function updateAgentModel(
  api: any,
  profileOpt: any,
  agentName: string,
  fullModelId: string,
  mode: "model" | "fallback",
  returnTarget: ProfileDetailReturnTarget = "hub"
) {
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, profileOpt.value);
  const runtimePolicy = resolveRuntimeOrchestratorPolicy(api.state.config);

  try {
    if (mode === "fallback") {
      const result = updateProfilePhaseModel(profilePath, agentName, "fallback", fullModelId, runtimePolicy);
      api.ui.toast({
        title: result.changed ? "Updated" : "No Changes",
        message: result.changed
          ? `${agentName} fallback set to ${fullModelId}. Version saved.`
          : `${agentName} fallback already uses ${fullModelId}`,
        variant: result.changed ? "success" : "warning",
      });
    } else {
      const result = updateProfilePhaseModel(profilePath, agentName, "primary", fullModelId, runtimePolicy);
      api.ui.toast({
        title: result.changed ? "Updated" : "No Changes",
        message: result.changed
          ? `${agentName} set to ${fullModelId}. Version saved.`
          : `${agentName} already uses ${fullModelId}`,
        variant: result.changed ? "success" : "warning",
      });
    }
    returnToProfileDetailTarget(api, profileOpt, returnTarget);
  } catch (e: any) {
    api.ui.toast({ title: "Error", message: `Failed to update agent: ${e.message}`, variant: "error" });
    returnToProfileDetailTarget(api, profileOpt, returnTarget);
  }
}

/**
 * Displays a list of recent memories associated with the current project
 * 
 * @param api - The TUI API instance
 */
export async function showProjectMemoriesMenu(api: any) {
  const projectName = resolveProjectName(api) || "project";

  try {
    const memories = await listProjectMemories(api);

    if (memories.length === 0) {
      api.ui.toast({
        title: "No Memories",
        message: `No project observations found for ${projectName}`,
        variant: "warning",
      });
      showProfilesMenuFn(api);
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Memories: ${projectName}`}
        options={[
          ...memories.map((m) => ({
            title: truncateText(`[${m.id}] ${m.title || m.topic_key || `Memory #${m.id}`}`, 60),
            value: String(m.id),
            description: `[${(m.type || "manual").toUpperCase()}] ${formatMemoryDate(
              m.updated_at || m.created_at
            )} · ${m.scope || "project"}`,
          })),
          { title: "← Back", value: "__back__", category: NAV_CATEGORY },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") showProfilesMenuFn(api);
          else {
            const memory = memories.find((item) => String(item.id) === opt.value);
            if (!memory) return;
            showMemoryDetail(api, memory);
          }
        }}
        onCancel={() => showProfilesMenuFn(api)}
      />
    ));
  } catch (e: any) {
    api.ui.toast({ title: "Error", message: `Failed to load memories: ${e.message}`, variant: "error" });
    showProfilesMenuFn(api);
  }
}
