import { describe, expect, it } from 'vitest';
import { BULK_ASSIGNMENT_MODE, BULK_ASSIGNMENT_TARGET, PROFILE_VERSION_SOURCE } from './types';
import { buildBulkProfileActionOptions, buildProfileVersionListOption, formatProfileVersionPreviewLines } from './dialogs';
import { buildProfileAgentRows } from './dialogs';
import { buildProfileDetailAgentSections, resolveRuntimeOrchestratorPolicy } from './dialogs';
import { getOrchestratorPolicy } from './orchestrator';

describe('dialog pure builders', () => {
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
});
