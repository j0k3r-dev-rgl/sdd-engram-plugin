import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BULK_ASSIGNMENT_MODE, BULK_ASSIGNMENT_TARGET, PROFILE_VERSION_SOURCE } from './types';
import { buildBulkProfileActionOptions, buildProfileVersionListOption, createFallbackSubmenuDialogProps, createPrimarySubmenuDialogProps, createReasoningSubmenuDialogProps, formatProfileVersionPreviewLines } from './dialogs';
import { buildProfileAgentRows } from './dialogs';
import { buildProfileDetailAgentSections, resolveRuntimeOrchestratorPolicy, buildReasoningRowForAgent, buildReasoningBlockedMessage } from './dialogs';
import { resolveProfileDetailSelectionAction } from './dialogs';
import {
  PROFILE_DETAIL_SUBMENU,
  buildFallbackSubmenuOptions,
  buildPrimaryModelSubmenuOptions,
  buildProfileDetailHubOptions,
  buildReasoningSubmenuOptions,
  resolveProfileDetailNavigationAction,
} from './dialogs';
import { getOrchestratorPolicy } from './orchestrator';

describe('dialog pure builders', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows canonical orchestrator row for updated runtime', () => {
    const policy = getOrchestratorPolicy(['gentle-orchestrator', 'sdd-init']);
    const rows = buildProfileAgentRows(
      ['sdd-orchestrator', 'gentle-orchestrator', 'sdd-init'],
      {
        models: {
          'sdd-orchestrator': 'legacy/model',
          'gentle-orchestrator': 'new/model',
          'sdd-init': 'phase/model',
        },
      },
      policy,
    );

    const titles = rows.map((row) => row.title);
    expect(titles).toContain('gentle-orchestrator');
    expect(titles).not.toContain('sdd-orchestrator');
  });

  it('derives updated-runtime policy from api.state.config and builds canonical detail rows', () => {
    const apiConfig = {
      default_agent: 'gentle-orchestrator',
      agent: {
        'sdd-init': { model: 'phase/model' },
        'sdd-orchestrator': { model: 'legacy/model' },
        'gentle-orchestrator': { model: 'new/model' },
      },
    };

    const policy = resolveRuntimeOrchestratorPolicy(apiConfig as any);
    const sections = buildProfileDetailAgentSections(apiConfig as any, {
      models: {
        'sdd-orchestrator': 'legacy/model',
        'gentle-orchestrator': 'new/model',
        'sdd-init': 'phase/model',
      },
      fallback: { 'sdd-init': 'fallback/model' },
    });

    expect(policy.canonicalName).toBe('gentle-orchestrator');
    expect(sections.sddAgents.map(([name]) => name)).toContain('gentle-orchestrator');
    expect(sections.sddAgents.map(([name]) => name)).not.toContain('sdd-orchestrator');
    expect(sections.sddAgents.find(([name]) => name === 'gentle-orchestrator')?.[1]).toBe('new/model');
    expect(sections.fallbackAgents).toEqual([
      ['sdd-init', 'fallback/model'],
    ]);
  });

  it('derives legacy policy from api.state.config and keeps legacy orchestrator in detail rows', () => {
    const apiConfig = {
      default_agent: 'sdd-orchestrator',
      agent: {
        'sdd-init': { model: 'phase/model' },
        'sdd-orchestrator': { model: 'legacy/model' },
      },
    };

    const policy = resolveRuntimeOrchestratorPolicy(apiConfig as any);
    const sections = buildProfileDetailAgentSections(apiConfig as any, {
      models: {
        'sdd-orchestrator': 'legacy/model',
        'sdd-init': 'phase/model',
      },
      fallback: {},
    });

    expect(policy.canonicalName).toBe('sdd-orchestrator');
    expect(sections.sddAgents.map(([name]) => name)).toContain('sdd-orchestrator');
    expect(sections.sddAgents.map(([name]) => name)).not.toContain('gentle-orchestrator');
  });

  it('builds fill-only and override bulk profile action labels mapped to target and mode', () => {
    const options = buildBulkProfileActionOptions();

    expect(options).toEqual([
      {
        title: 'Set all primary phases',
        value: 'bulk:fill-only:primary',
        operation: { target: BULK_ASSIGNMENT_TARGET.PRIMARY, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
        requiresConfirmation: false,
      },
      {
        title: 'Set all fallback phases',
        value: 'bulk:fill-only:fallback',
        operation: { target: BULK_ASSIGNMENT_TARGET.FALLBACK, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
        requiresConfirmation: false,
      },
      {
        title: 'Set all phases and fallbacks',
        value: 'bulk:fill-only:both',
        operation: { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
        requiresConfirmation: false,
      },
      {
        title: 'Override all primary phases',
        value: 'bulk:overwrite:primary',
        operation: { target: BULK_ASSIGNMENT_TARGET.PRIMARY, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
        requiresConfirmation: true,
      },
      {
        title: 'Override all fallback phases',
        value: 'bulk:overwrite:fallback',
        operation: { target: BULK_ASSIGNMENT_TARGET.FALLBACK, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
        requiresConfirmation: true,
      },
      {
        title: 'Override all phases and fallbacks',
        value: 'bulk:overwrite:both',
        operation: { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
        requiresConfirmation: true,
      },
    ]);
  });

  it('formats profile version previews with date, operation, assignments, and raw excerpt', () => {
    const lines = formatProfileVersionPreviewLines({
      version: 1,
      id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
      profileFile: 'team.json',
      createdAt: '2026-04-26T10:00:00.000Z',
      source: PROFILE_VERSION_SOURCE.PHASE,
      operation: { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
      operationSummary: 'Set 2 primary and 1 fallback phases',
      beforeRaw: '{"models":{"sdd-init":"old/model"},"fallback":{"sdd-init":"old/fallback"}}',
      preview: { models: { 'sdd-init': 'old/model' }, fallback: { 'sdd-init': 'old/fallback' } }
    });

    expect(lines).toContain('Profile: team.json');
    expect(lines).toContain('Source: Phase');
    expect(lines).toContain('Operation: Set 2 primary and 1 fallback phases');
    expect(lines).toContain('Primary: sdd-init -> old/model');
    expect(lines).toContain('Fallback: sdd-init -> old/fallback');
    expect(lines.some((line) => line.startsWith('Raw: {"models"'))).toBe(true);
  });

  it('builds version list labels with source, date, and operation summary', () => {
    const option = buildProfileVersionListOption({
      version: 1,
      id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
      profileFile: 'team.json',
      createdAt: '2026-04-26T10:00:00.000Z',
      source: PROFILE_VERSION_SOURCE.BULK,
      operation: { source: PROFILE_VERSION_SOURCE.BULK, target: BULK_ASSIGNMENT_TARGET.PRIMARY, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
      operationSummary: 'Override all primary phases: 2 primary, 0 fallback',
      preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
    });

    expect(option).toEqual({
      title: expect.stringContaining('Bulk'),
      value: 'team.json/2026-04-26T10-00-00-000Z-a.json',
      description: 'Override all primary phases: 2 primary, 0 fallback',
    });
    expect(option.title).toContain('2026');
  });

  it('builds reasoning detail row with saved value and stable action token', () => {
    const withValue = buildReasoningRowForAgent({ configs: { 'sdd-apply': { reasoningEffort: 'high' } } }, 'sdd-apply');
    expect(withValue).toEqual({
      title: 'sdd-apply reasoning effort',
      value: 'reasoning:sdd-apply',
      description: 'Saved: high',
      category: 'Reasoning (PRIMARY SDD only)',
    });

    const withoutValue = buildReasoningRowForAgent({}, 'sdd-apply');
    expect(withoutValue.description).toBe('Unset');
  });

  it('returns explicit blocked messages for missing-model and unsupported states', () => {
    expect(buildReasoningBlockedMessage({ kind: 'missing-model', agentName: 'sdd-apply' }))
      .toContain('Assign a primary model');

    expect(buildReasoningBlockedMessage({ kind: 'unsupported', agentName: 'sdd-apply', modelId: 'openai/gpt-4.1' }))
      .toContain('does not expose reasoning effort options');
  });

  it('routes profile detail selection actions to reasoning/model/fallback branches', () => {
    expect(resolveProfileDetailSelectionAction('reasoning:sdd-apply')).toEqual({ action: 'reasoning', agentName: 'sdd-apply' });
    expect(resolveProfileDetailSelectionAction('model:sdd-design')).toEqual({ action: 'model', agentName: 'sdd-design' });
    expect(resolveProfileDetailSelectionAction('fallback:sdd-design')).toEqual({ action: 'fallback', agentName: 'sdd-design' });
  });

  it('does not route navigation/internal tokens as reasoning edit actions', () => {
    expect(resolveProfileDetailSelectionAction('__back__')).toEqual({ action: 'noop' });
    expect(resolveProfileDetailSelectionAction('')).toEqual({ action: 'noop' });
    expect(resolveProfileDetailSelectionAction('unknown-token')).toEqual({ action: 'noop' });
  });

  it('builds profile detail hub with inline primary rows and reasoning/fallback navigation entries', () => {
    const api = { state: { config: { agent: { 'sdd-apply': {}, 'sdd-design': {} } }, provider: [] } } as any;
    const profileOpt = { title: 'team', value: 'team.json' };
    const profileData = {
      models: { 'sdd-apply': 'openai/gpt-4.1', 'sdd-design': 'openai/gpt-4.1-mini' },
      fallback: { 'sdd-apply': 'openai/gpt-4.1-mini' },
      configs: { 'sdd-apply': { reasoningEffort: 'medium' } },
    };

    const options = buildProfileDetailHubOptions(api as any, profileOpt, profileData);
    const submenuValues = options
      .filter((option) => option.value.startsWith('__submenu_'))
      .map((option) => option.value)
      .sort();

    expect(submenuValues).toEqual([
      PROFILE_DETAIL_SUBMENU.FALLBACK,
      PROFILE_DETAIL_SUBMENU.REASONING,
    ]);

    const optionValues = options.map((option) => option.value);
    expect(optionValues.some((value) => String(value).startsWith('model:'))).toBe(true);
    expect(optionValues.some((value) => String(value).startsWith('reasoning:'))).toBe(false);
    expect(optionValues.some((value) => String(value).startsWith('fallback:'))).toBe(false);
    expect(optionValues).toContain('__rename__');
    expect(optionValues).toContain('__profile_versions__');
    expect(optionValues[1]).toBe('__bulk_actions__');

    const profileVersionsOption = options.find((option) => option.value === '__profile_versions__');
    expect(profileVersionsOption?.category).toBe('Agents');
    const bulkActionsOption = options.find((option) => option.value === '__bulk_actions__');
    expect(bulkActionsOption?.category).toBe('Model Navigation');
  });

  it('builds submenu option sets and resolves submenu navigation tokens', () => {
    const profileData = {
      models: { 'sdd-apply': 'openai/gpt-4.1', 'sdd-design': 'openai/gpt-4.1-mini' },
      fallback: { 'sdd-design': 'openai/gpt-4.1-nano' },
      configs: { 'sdd-apply': { reasoningEffort: 'high' } },
    };
    const sections = {
      sddAgentNames: ['sdd-apply', 'sdd-design'],
      sddAgents: [
        ['sdd-apply', 'openai/gpt-4.1'],
        ['sdd-design', 'openai/gpt-4.1-mini'],
      ],
      fallbackAgents: [
        ['sdd-design', 'openai/gpt-4.1-nano'],
      ],
      policy: { canonicalName: 'sdd-orchestrator' },
    } as any;

    const primary = buildPrimaryModelSubmenuOptions(profileData, sections);
    const reasoning = buildReasoningSubmenuOptions(profileData, sections);
    const fallback = buildFallbackSubmenuOptions(profileData, sections);

    expect(primary.some((option) => option.value === 'model:sdd-apply')).toBe(true);
    expect(reasoning.some((option) => option.value === 'reasoning:sdd-design')).toBe(true);
    expect(fallback.some((option) => option.value === 'fallback:sdd-design')).toBe(true);
    expect(primary.at(-1)?.value).toBe('__back__');
    expect(reasoning.at(-1)?.value).toBe('__back__');
    expect(fallback.at(-1)?.value).toBe('__back__');

    expect(resolveProfileDetailNavigationAction(PROFILE_DETAIL_SUBMENU.PRIMARY)).toEqual({ action: 'submenu-primary' });
    expect(resolveProfileDetailNavigationAction(PROFILE_DETAIL_SUBMENU.REASONING)).toEqual({ action: 'submenu-reasoning' });
    expect(resolveProfileDetailNavigationAction(PROFILE_DETAIL_SUBMENU.FALLBACK)).toEqual({ action: 'submenu-fallback' });
    expect(resolveProfileDetailNavigationAction('__back__')).toEqual({ action: 'back' });
    expect(resolveProfileDetailNavigationAction('model:sdd-apply')).toEqual({ action: 'selection' });
  });

  it('runtime: Back from each submenu returns safely to profile detail hub without writes', () => {
    const api = { state: { config: { agent: { 'sdd-apply': {}, 'sdd-design': {} } }, provider: [] } } as any;
    const profileOpt = { title: 'team', value: 'team.json' };
    const profileData = { models: { 'sdd-apply': 'openai/gpt-4.1' }, fallback: {}, configs: {} } as any;
    const sections = buildProfileDetailAgentSections(api.state.config, profileData);
    const showHub = vi.fn();
    const showProvider = vi.fn();
    const showReasoning = vi.fn();

    const primary = createPrimarySubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showProviderPickerForAgent: showProvider });
    const reasoning = createReasoningSubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showReasoningEffortPicker: showReasoning });
    const fallback = createFallbackSubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showProviderPickerForAgent: showProvider });

    primary.onSelect({ value: '__back__' });
    reasoning.onSelect({ value: '__back__' });
    fallback.onSelect({ value: '__back__' });

    expect(showHub).toHaveBeenCalledTimes(3);
    expect(showProvider).not.toHaveBeenCalled();
    expect(showReasoning).not.toHaveBeenCalled();
  });

  it('runtime: Cancel from each submenu returns safely to profile detail hub without writes', () => {
    const api = { state: { config: { agent: { 'sdd-apply': {}, 'sdd-design': {} } }, provider: [] } } as any;
    const profileOpt = { title: 'team', value: 'team.json' };
    const profileData = { models: { 'sdd-apply': 'openai/gpt-4.1' }, fallback: {}, configs: {} } as any;
    const sections = buildProfileDetailAgentSections(api.state.config, profileData);
    const showHub = vi.fn();
    const showProvider = vi.fn();
    const showReasoning = vi.fn();

    const primary = createPrimarySubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showProviderPickerForAgent: showProvider });
    const reasoning = createReasoningSubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showReasoningEffortPicker: showReasoning });
    const fallback = createFallbackSubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showProviderPickerForAgent: showProvider });

    primary.onCancel();
    reasoning.onCancel();
    fallback.onCancel();

    expect(showHub).toHaveBeenCalledTimes(3);
    expect(showProvider).not.toHaveBeenCalled();
    expect(showReasoning).not.toHaveBeenCalled();
  });

  it('runtime: submenu routing preserves edit semantics and persists only on explicit edit confirmation', () => {
    const api = { state: { config: { agent: { 'sdd-apply': {}, 'sdd-design': {} } }, provider: [] } } as any;
    const profileOpt = { title: 'team', value: 'team.json' };
    const profileData = {
      models: { 'sdd-apply': 'openai/gpt-4.1', 'sdd-design': 'openai/gpt-4.1-mini' },
      fallback: { 'sdd-apply': 'openai/gpt-4.1-mini' },
      configs: { 'sdd-apply': { reasoningEffort: 'medium' } },
    } as any;
    const sections = buildProfileDetailAgentSections(api.state.config, profileData);
    const showHub = vi.fn();
    const showProvider = vi.fn();
    const showReasoning = vi.fn();

    const primary = createPrimarySubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showProviderPickerForAgent: showProvider });
    const reasoning = createReasoningSubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showReasoningEffortPicker: showReasoning });
    const fallback = createFallbackSubmenuDialogProps(api, profileOpt, profileData, sections, { showProfileDetail: showHub, showProviderPickerForAgent: showProvider });

    primary.onSelect({ value: 'model:sdd-apply' });
    fallback.onSelect({ value: 'fallback:sdd-apply' });
    reasoning.onSelect({ value: 'reasoning:sdd-apply' });

    expect(showProvider).toHaveBeenNthCalledWith(1, api, profileOpt, 'sdd-apply', 'model');
    expect(showProvider).toHaveBeenNthCalledWith(2, api, profileOpt, 'sdd-apply', 'fallback');
    expect(showReasoning).toHaveBeenCalledWith(api, profileOpt, 'sdd-apply');
    expect(showHub).not.toHaveBeenCalled();
  });
});
