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
    const { sddAgents, fallbackAgents } = buildProfileDetailAgentSections(api.state.config, profileData);

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Profile: ${profileOpt.title}`}
        options={[
          { title: `✏ Name: ${profileOpt.title}`, value: "__rename__", category: "Profile" },
          {
            title: "Bulk actions...",
            value: "__bulk_actions__",
            description: "Fill or override primary and fallback SDD phase assignments",
            category: "Agents (Click to edit model)",
          },
          {
            title: "Profile versions...",
            value: "__profile_versions__",
            description: "Preview and restore previous profile versions",
            category: "Profile",
          },
          ...sddAgents.map(([name, modelId]) => ({
            title: name,
            value: `model:${name}`,
            description: resolveModelInfo(api, modelId),
            category: "Agents (Click to edit model)",
          })),
          ...fallbackAgents.map(([name, modelId]) => ({
            title: `${name} -> ${name}-fallback`,
            value: `fallback:${name}`,
            description: modelId ? resolveModelInfo(api, modelId) : "Inherited from base model",
            category: "Fallback Models (Click to edit model)",
          })),
          { title: "✓ Activate Profile", value: "__assign__", category: NAV_CATEGORY },
          { title: "✕ Delete Profile", value: "__delete__", category: NAV_CATEGORY },
          { title: "← Back", value: "__back__", category: NAV_CATEGORY },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") showProfileListFn(api);
          else if (opt.value === "__assign__") handleActivateProfile(api, profilePath, profileOpt.title);
          else if (opt.value === "__delete__") showDeleteProfile(api, profileOpt);
          else if (opt.value === "__rename__") showRenameProfile(api, profileOpt);
          else if (opt.value === "__bulk_actions__") showBulkProfileActions(api, profileOpt);
          else if (opt.value === "__profile_versions__") showProfileVersions(api, profileOpt);
          else if (!opt.value.startsWith("__") && opt.value.startsWith("model:")) {
            showProviderPickerForAgent(api, profileOpt, opt.value.replace("model:", ""), "model");
          } else if (!opt.value.startsWith("__") && opt.value.startsWith("fallback:")) {
            showProviderPickerForAgent(api, profileOpt, opt.value.replace("fallback:", ""), "fallback");
          }
        }}
        onCancel={() => showProfileListFn(api)}
      />
    ));
  } catch (e) {
    api.ui.toast({ title: "Error", message: "Failed to read profile details", variant: "error" });
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
function showProviderPickerForAgent(api: any, profileOpt: any, agentName: string, mode: "model" | "fallback") {
  const providers = (api.state.provider || []).filter((p: any) => Object.keys(p.models || {}).length > 0);

  if (providers.length === 0) {
    api.ui.toast({ title: "No Providers", message: "No authenticated providers found.", variant: "warning" });
    showProfileDetailFn(api, profileOpt);
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
        if (opt.value === "__back__") showProfileDetailFn(api, profileOpt);
        else {
          const selected = providers.find((p: any) => p.id === opt.value);
          showModelPickerForAgent(api, profileOpt, agentName, selected, mode);
        }
      }}
      onCancel={() => showProfileDetailFn(api, profileOpt)}
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
  mode: "model" | "fallback"
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
        if (opt.value === "__back__") showProviderPickerForAgent(api, profileOpt, agentName, mode);
        else updateAgentModel(api, profileOpt, agentName, opt.value, mode);
      }}
      onCancel={() => showProviderPickerForAgent(api, profileOpt, agentName, mode)}
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
  mode: "model" | "fallback"
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
    showProfileDetailFn(api, profileOpt);
  } catch (e: any) {
    api.ui.toast({ title: "Error", message: `Failed to update agent: ${e.message}`, variant: "error" });
    showProfileDetailFn(api, profileOpt);
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
