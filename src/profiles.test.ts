import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import type { ProfileData } from './types';
import { BULK_ASSIGNMENT_MODE, BULK_ASSIGNMENT_TARGET, PROFILE_VERSION_SOURCE } from './types';
import { formatProfileVersionPreviewLines, resolveRuntimeOrchestratorPolicy } from './dialogs';
import {
  extractSddAgentModels, 
  extractSddFallbackModels, 
  readProfileModels, 
  readProfileFallbackModels, 
  writeProfileModels,
  writeProfileFallbackModels,
  sanitizeProfileName,
  syncSddFallbackAgents, 
  validateProfileFallbackMapping,
  isSddProfile,
  applyProfileDataToConfig,
  applyBulkProfilePhaseAssignment,
  assignModelToUnassignedProfilePhases,
  readProfileData,
  writeProfileData,
  createProfileVersion,
  listProfileVersions,
  readProfileVersion,
  restoreProfileVersion,
  updateProfileWithBulkPhaseAssignment,
   updateProfilePhaseModel,
   detectActiveProfileFile,
   activateProfileFile,
   deleteProfileFile,
   renameProfileFile,
   migrateProfilesForRuntimePolicy
} from './profiles';
import { getOrchestratorPolicy } from './orchestrator';

vi.mock('node:fs');
vi.mock('./config', () => ({
  resolvePaths: () => ({
    profilesDir: '/mock/profiles',
    configRoot: '/mock/config',
    configPath: '/mock/config/opencode.json',
    backupPath: '/mock/config/opencode.json.bak',
    profileVersionsDir: '/mock/config/profile-versions'
  }),
  ensureProfilesDir: vi.fn()
}));

describe('profiles logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isSddProfile', () => {
    it('should correctly identify .json files', () => {
      expect(isSddProfile('profile.json')).toBe(true);
      expect(isSddProfile('readme.md')).toBe(false);
      expect(isSddProfile('config')).toBe(false);
    });
  });

  describe('sanitizeProfileName', () => {
    it('accepts safe names and strips a trailing json extension', () => {
      expect(sanitizeProfileName(' team-default.json ')).toBe('team-default');
      expect(sanitizeProfileName('team default.v2')).toBe('team default.v2');
    });

    it('rejects empty, traversal, separators, and unsafe characters', () => {
      expect(() => sanitizeProfileName('   ')).toThrow('Profile name cannot be empty');
      expect(() => sanitizeProfileName('../team')).toThrow('unsafe characters');
      expect(() => sanitizeProfileName('team/nested')).toThrow('unsafe characters');
      expect(() => sanitizeProfileName('team*prod')).toThrow('unsafe characters');
    });
  });

  describe('extractSddAgentModels', () => {
    it('should extract models for primary SDD agents', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' },
          'sdd-apply': { model: 'claude-3' },
          'other-agent': { model: 'mistral' },
          'sdd-init-fallback': { model: 'gpt-3.5' } // Should ignore fallback
        }
      };
      
      const models = extractSddAgentModels(config);
      expect(models).toEqual({
        'sdd-init': 'gpt-4',
        'sdd-apply': 'claude-3'
      });
    });

    it('should return empty object if no agent field', () => {
      expect(extractSddAgentModels({})).toEqual({});
    });
  });

  describe('extractSddFallbackModels', () => {
    it('should extract fallback mapping', () => {
      const raw = {
        fallback: {
          'sdd-init': 'gpt-3.5',
          'sdd-apply': 'sonnet',
          'invalid': 'foo'
        }
      };
      
      const fallback = extractSddFallbackModels(raw);
      expect(fallback).toEqual({
        'sdd-init': 'gpt-3.5',
        'sdd-apply': 'sonnet'
      });
    });

    it('should handle missing fallback field', () => {
      expect(extractSddFallbackModels({})).toEqual({});
    });
  });

  describe('readProfileModels', () => {
    it('should parse new profile format', () => {
      const mockContent = JSON.stringify({
        models: { 'sdd-init': 'gpt-4' },
        fallback: { 'sdd-init': 'gpt-3.5' }
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);
      
      const models = readProfileModels('/mock/profiles/test.json');
      expect(models).toEqual({ 'sdd-init': 'gpt-4' });
    });

    it('should parse legacy flat format', () => {
      const mockContent = JSON.stringify({
        'sdd-init': 'gpt-4',
        'sdd-apply': { model: 'claude-3' }
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);
      
      const models = readProfileModels('/mock/profiles/legacy.json');
      expect(models).toEqual({
        'sdd-init': 'gpt-4',
        'sdd-apply': 'claude-3'
      });
    });

    it('should parse full config format', () => {
      const mockContent = JSON.stringify({
        agent: { 'sdd-init': { model: 'gpt-4' } }
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);
      
      const models = readProfileModels('/mock/profiles/config.json');
      expect(models).toEqual({ 'sdd-init': 'gpt-4' });
    });

    it('preserves gentle-orchestrator when reading migrated profile payloads', () => {
      const mockContent = JSON.stringify({
        models: {
          'gentle-orchestrator': 'openai/gpt-5',
          'sdd-init': 'openai/gpt-4'
        }
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const models = readProfileModels('/mock/profiles/migrated.json');
      expect(models).toEqual({
        'gentle-orchestrator': 'openai/gpt-5',
        'sdd-init': 'openai/gpt-4'
      });
    });

    it('returns empty models for corrupted json payloads instead of throwing', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('{invalid json');

      expect(readProfileModels('/mock/profiles/corrupt.json')).toEqual({});
    });
  });

  describe('readProfileData and writeProfileData', () => {
    it('migrates legacy orchestrator to gentle-orchestrator on write in updated runtime', () => {
      const policy = getOrchestratorPolicy(['gentle-orchestrator', 'sdd-init']);

      writeProfileData('/mock/profiles/compatible.json', {
        models: {
          'sdd-orchestrator': 'legacy/model',
          'sdd-init': 'phase/model',
        },
      } as any, policy);

      const persisted = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]?.[1]));
      expect(persisted.models['gentle-orchestrator']).toBe('legacy/model');
      expect(persisted.models['sdd-orchestrator']).toBeUndefined();
    });

    it('preserves unrelated profile fields when reading and writing full profile data', () => {
      const mockContent = JSON.stringify({
        models: { 'sdd-init': 'gpt-4' },
        fallback: { 'sdd-init': 'gpt-3.5' },
        description: 'team defaults'
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profileData = readProfileData('/mock/profiles/compatible.json');
      writeProfileData('/mock/profiles/compatible.json', profileData);

      expect(profileData).toEqual({
        models: { 'sdd-init': 'gpt-4' },
        fallback: { 'sdd-init': 'gpt-3.5' },
        description: 'team defaults'
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/),
        JSON.stringify(profileData, null, 2)
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/compatible.json'
      );
    });

    it('writes canonical profile payloads without stale legacy or config-shaped fields', () => {
      writeProfileData('/mock/profiles/compatible.json', {
        models: { 'sdd-init': ' gpt-4 ', 'not-sdd': 'ignore-me' } as any,
        fallback: { 'sdd-init': ' gpt-3.5 ', 'invalid': 'ignore-me' } as any,
        description: 'team defaults',
        agent: { 'sdd-init': { model: 'stale/model' } },
        'sdd-init': 'legacy/model',
      } as any);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/),
        JSON.stringify({
          description: 'team defaults',
          models: { 'sdd-init': 'gpt-4' },
          fallback: { 'sdd-init': 'gpt-3.5' }
        }, null, 2)
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/compatible.json'
      );
    });

    it('omits empty fallback maps when reading and writing full profile data', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-init': 'gpt-4' },
        fallback: {},
        description: 'team defaults'
      }));

      const profileData = readProfileData('/mock/profiles/compatible.json');
      writeProfileData('/mock/profiles/compatible.json', profileData);

      expect(profileData).toEqual({
        models: { 'sdd-init': 'gpt-4' },
        description: 'team defaults'
      });
      expect(fs.writeFileSync).toHaveBeenLastCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/),
        JSON.stringify({
          description: 'team defaults',
          models: { 'sdd-init': 'gpt-4' }
        }, null, 2)
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/compatible.json'
      );
    });

    it('reads and parses profile json only once and degrades safely when corrupt', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('{invalid json');

      expect(readProfileData('/mock/profiles/corrupt.json')).toEqual({ models: {} });
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('cleans temporary files when atomic profile rename fails and fsyncs written content', () => {
      vi.mocked(fs.openSync).mockReturnValue(123 as any);
      vi.mocked(fs.renameSync).mockImplementationOnce((fromPath: any, toPath: any) => {
        if (String(toPath) === '/mock/profiles/compatible.json') {
          throw new Error('rename failed');
        }

        return undefined as any;
      });

      expect(() => writeProfileData('/mock/profiles/compatible.json', { models: { 'sdd-init': 'gpt-4' } })).toThrow('rename failed');
      expect(fs.fsyncSync).toHaveBeenCalledWith(123);
      expect(fs.closeSync).toHaveBeenCalledWith(123);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/)
      );
    });

    it('fsyncs both temp file and parent directory during atomic write', () => {
      vi.mocked(fs.openSync)
        .mockReturnValueOnce(101 as any)
        .mockReturnValueOnce(202 as any);

      writeProfileData('/mock/profiles/compatible.json', { models: { 'sdd-init': 'gpt-4' } });

      expect(fs.openSync).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/^\/mock\/profiles\/compatible\.json\.tmp-[0-9a-f]{8}$/),
        'r+'
      );
      expect(fs.openSync).toHaveBeenNthCalledWith(2, '/mock/profiles', 'r');
      expect(fs.fsyncSync).toHaveBeenCalledWith(101);
      expect(fs.fsyncSync).toHaveBeenCalledWith(202);
      expect(fs.closeSync).toHaveBeenCalledWith(101);
      expect(fs.closeSync).toHaveBeenCalledWith(202);
    });

    it('writeProfileModels preserves non-model profile fields', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-init': 'old/model' },
        fallback: { 'sdd-init': 'old/fallback' },
        description: 'team defaults'
      }));

      writeProfileModels('/mock/profiles/compatible.json', { 'sdd-init': 'new/model' });

      const persisted = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]?.[1]));
      expect(persisted).toEqual({
        models: { 'sdd-init': 'new/model' },
        fallback: { 'sdd-init': 'old/fallback' },
        description: 'team defaults'
      });
    });

    it('writeProfileFallbackModels preserves non-model profile fields', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-init': 'old/model' },
        fallback: { 'sdd-init': 'old/fallback' },
        description: 'team defaults'
      }));

      writeProfileFallbackModels('/mock/profiles/compatible.json', { 'sdd-init': 'new/fallback' });

      const persisted = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]?.[1]));
      expect(persisted).toEqual({
        models: { 'sdd-init': 'old/model' },
        fallback: { 'sdd-init': 'new/fallback' },
        description: 'team defaults'
      });
    });
  });

  describe('validateProfileFallbackMapping', () => {
    it('should return empty list on success', () => {
      const config = {
        agent: { 'sdd-init': { model: 'gpt-4' } }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const errors = validateProfileFallbackMapping(config, fallback);
      expect(errors).toEqual([]);
    });

    it('should catch invalid fallback targets', () => {
      const config = { agent: {} };
      const fallback = { 'sdd-orchestrator': 'gpt-4', 'invalid': 'foo' };
      
      const errors = validateProfileFallbackMapping(config, fallback);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('sdd-orchestrator');
    });

    it('should catch missing targets in config', () => {
      const config = { agent: {} };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const errors = validateProfileFallbackMapping(config, fallback);
      expect(errors).toContain("Fallback target 'sdd-init' does not exist in active config.");
    });
  });

  describe('syncSddFallbackAgents', () => {
    it('should create new fallback agents', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4', other: 'meta' }
        }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const nextConfig = syncSddFallbackAgents(config, fallback);
      expect(nextConfig.agent['sdd-init-fallback']).toEqual({
        model: 'gpt-3.5',
        other: 'meta'
      });
    });

    it('should override existing fallback agents if base agent changes', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4', other: 'new-meta' },
          'sdd-init-fallback': { model: 'gpt-3.5', other: 'old-meta' }
        }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const nextConfig = syncSddFallbackAgents(config, fallback);
      expect(nextConfig.agent['sdd-init-fallback'].other).toBe('new-meta');
    });

    it('should inherit base model if no override provided', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' }
        }
      };
      const fallback = {};
      
      const nextConfig = syncSddFallbackAgents(config, fallback);
      expect(nextConfig.agent['sdd-init-fallback'].model).toBe('gpt-4');
    });

    it('should be idempotent', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' }
        }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const firstPass = syncSddFallbackAgents(config, fallback);
      const secondPass = syncSddFallbackAgents(firstPass, fallback);
      
      expect(firstPass).toEqual(secondPass);
    });
  });

  describe('applyProfileDataToConfig', () => {
    it('should apply both primary models and fallback reconciliation', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' }
        }
      };
      const profile = {
        models: { 'sdd-init': 'claude-3' },
        fallback: { 'sdd-init': 'gpt-3.5' }
      };
      
      const nextConfig = applyProfileDataToConfig(config, profile);
      expect(nextConfig.agent['sdd-init'].model).toBe('claude-3');
      expect(nextConfig.agent['sdd-init-fallback'].model).toBe('gpt-3.5');
    });
  });

  describe('assignModelToUnassignedProfilePhases', () => {
    it('fills missing and blank primary SDD model assignments', () => {
      const profile = {
        models: {
          'sdd-init': '',
          'sdd-spec': '   ',
          'sdd-design': 'existing/provider',
        },
        fallback: {}
      };

      const result = assignModelToUnassignedProfilePhases(
        profile,
        ['sdd-init', 'sdd-apply', 'sdd-spec', 'sdd-design'],
        'provider/model'
      );

      expect(result.modelsAssigned).toBe(3);
      expect(result.profile.models).toEqual({
        'sdd-init': 'provider/model',
        'sdd-apply': 'provider/model',
        'sdd-spec': 'provider/model',
        'sdd-design': 'existing/provider',
      });
      expect(profile.models['sdd-init']).toBe('');
    });

    it('fills missing and blank fallback entries only for fallback-eligible SDD agents', () => {
      const profile = {
        models: {},
        fallback: {
          'sdd-init': '',
          'sdd-apply': '   ',
          'sdd-spec': 'fallback/existing'
        }
      };

      const result = assignModelToUnassignedProfilePhases(
        profile,
        ['sdd-init', 'sdd-apply', 'sdd-orchestrator', 'not-sdd'],
        'provider/model'
      );

      expect(result.fallbackAssigned).toBe(2);
      expect(result.profile.fallback).toEqual({
        'sdd-init': 'provider/model',
        'sdd-apply': 'provider/model',
        'sdd-spec': 'fallback/existing'
      });
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
    });

    it('fills primary and fallback assignments for sparse profiles without models or fallback maps', () => {
      const result = assignModelToUnassignedProfilePhases(
        {} as ProfileData,
        ['sdd-init', 'sdd-apply', 'sdd-orchestrator', 'sdd-init-fallback', 'not-sdd'],
        'provider/model'
      );

      expect(result.modelsAssigned).toBe(3);
      expect(result.fallbackAssigned).toBe(2);
      expect(result.profile).toEqual({
        models: {
          'sdd-init': 'provider/model',
          'sdd-apply': 'provider/model',
          'sdd-orchestrator': 'provider/model'
        },
        fallback: {
          'sdd-init': 'provider/model',
          'sdd-apply': 'provider/model'
        }
      });
    });

    it('preserves existing non-empty primary and fallback assignments', () => {
      const profile = {
        models: {
          'sdd-init': 'primary/existing',
          'sdd-apply': 'primary/other'
        },
        fallback: {
          'sdd-init': 'fallback/existing',
          'sdd-apply': 'fallback/other'
        }
      };

      const result = assignModelToUnassignedProfilePhases(
        profile,
        ['sdd-init', 'sdd-apply'],
        'provider/model'
      );

      expect(result.modelsAssigned).toBe(0);
      expect(result.fallbackAssigned).toBe(0);
      expect(result.profile).toEqual(profile);
    });

    it('ignores non-SDD agents and generated fallback agents and is idempotent', () => {
      const first = assignModelToUnassignedProfilePhases(
        { models: {}, fallback: {} },
        ['sdd-init', 'sdd-init-fallback', 'sdd-orchestrator', 'general-agent'],
        'provider/model'
      );

      expect(first.modelsAssigned).toBe(2);
      expect(first.fallbackAssigned).toBe(1);
      expect(first.profile.models).toEqual({
        'sdd-init': 'provider/model',
        'sdd-orchestrator': 'provider/model'
      });
      expect(first.profile.fallback).toEqual({
        'sdd-init': 'provider/model'
      });

      const second = assignModelToUnassignedProfilePhases(
        first.profile,
        ['sdd-init', 'sdd-init-fallback', 'sdd-orchestrator', 'general-agent'],
        'provider/model'
      );

      expect(second.modelsAssigned).toBe(0);
      expect(second.fallbackAssigned).toBe(0);
      expect(second.profile).toEqual(first.profile);
    });

    it('rejects blank model ids without changing profile data', () => {
      const profile = { models: { 'sdd-init': '' }, fallback: {} };

      expect(() =>
        assignModelToUnassignedProfilePhases(profile, ['sdd-init'], '   ')
      ).toThrow('modelId must be a non-empty string');
      expect(profile.models['sdd-init']).toBe('');
    });
  });

  describe('applyBulkProfilePhaseAssignment', () => {
    const agents = ['sdd-init', 'sdd-spec', 'sdd-design', 'sdd-apply', 'sdd-orchestrator', 'sdd-init-fallback', 'general'];

    it('fills only unassigned primary phase models without touching fallbacks', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': '', 'sdd-spec': 'existing/spec', 'sdd-design': '   ' },
        fallback: { 'sdd-init': 'fallback/existing' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.PRIMARY,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(4);
      expect(result.fallbackAssigned).toBe(0);
      expect(result.profile.models).toEqual({
        'sdd-init': 'provider/model',
        'sdd-spec': 'existing/spec',
        'sdd-design': 'provider/model',
        'sdd-apply': 'provider/model',
        'sdd-orchestrator': 'provider/model'
      });
      expect(result.profile.fallback).toEqual({ 'sdd-init': 'fallback/existing' });
      expect(profile.models['sdd-init']).toBe('');
    });

    it('fills only unassigned fallback phase models without touching primary models', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': 'primary/existing' },
        fallback: { 'sdd-init': '', 'sdd-spec': 'fallback/existing' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.FALLBACK,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(0);
      expect(result.fallbackAssigned).toBe(3);
      expect(result.profile.models).toEqual({ 'sdd-init': 'primary/existing' });
      expect(result.profile.fallback).toEqual({
        'sdd-init': 'provider/model',
        'sdd-spec': 'fallback/existing',
        'sdd-design': 'provider/model',
        'sdd-apply': 'provider/model'
      });
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
    });

    it('fills unassigned primary and fallback phase models for both target', () => {
      const result = applyBulkProfilePhaseAssignment({ models: {}, fallback: {} }, agents, 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(5);
      expect(result.fallbackAssigned).toBe(4);
      expect(result.profile.models['sdd-orchestrator']).toBe('provider/model');
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
      expect(result.profile.models['sdd-init-fallback']).toBeUndefined();
    });

    it('overrides only primary phase models for primary target', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': 'old/init', 'sdd-spec': 'old/spec' },
        fallback: { 'sdd-init': 'fallback/old' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/new', {
        target: BULK_ASSIGNMENT_TARGET.PRIMARY,
        mode: BULK_ASSIGNMENT_MODE.OVERWRITE
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(5);
      expect(result.fallbackAssigned).toBe(0);
      expect(result.profile.models['sdd-init']).toBe('provider/new');
      expect(result.profile.models['sdd-orchestrator']).toBe('provider/new');
      expect(result.profile.fallback).toEqual({ 'sdd-init': 'fallback/old' });
    });

    it('overrides only fallback phase models for fallback target', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': 'primary/old' },
        fallback: { 'sdd-init': 'fallback/old', 'sdd-apply': 'fallback/apply' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/new', {
        target: BULK_ASSIGNMENT_TARGET.FALLBACK,
        mode: BULK_ASSIGNMENT_MODE.OVERWRITE
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(0);
      expect(result.fallbackAssigned).toBe(4);
      expect(result.profile.models).toEqual({ 'sdd-init': 'primary/old' });
      expect(result.profile.fallback?.['sdd-init']).toBe('provider/new');
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
    });

    it('overrides primary and fallback phase models for both target', () => {
      const result = applyBulkProfilePhaseAssignment(
        { models: { 'sdd-init': 'old' }, fallback: { 'sdd-init': 'old-fallback' } },
        agents,
        'provider/new',
        { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.OVERWRITE }
      );

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(5);
      expect(result.fallbackAssigned).toBe(4);
      expect(result.profile.models['sdd-init']).toBe('provider/new');
      expect(result.profile.fallback?.['sdd-init']).toBe('provider/new');
    });

    it('rejects blank models and reports no change for fill-only no-op', () => {
      const profile: ProfileData = { models: { 'sdd-init': 'existing' }, fallback: { 'sdd-init': 'existing-fallback' } };

      expect(() => applyBulkProfilePhaseAssignment(profile, ['sdd-init'], '   ', {
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      })).toThrow('modelId must be a non-empty string');

      const noOp = applyBulkProfilePhaseAssignment(profile, ['sdd-init'], 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });
      expect(noOp.changed).toBe(false);
      expect(noOp.profile).toEqual(profile);
    });
  });

  describe('profile versions', () => {
    const operation = { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY };

    it('creates dated profile versions under controlled storage with raw content and preview metadata', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-init': 'old/model' },
        fallback: { 'sdd-init': 'old/fallback' }
      }));

      const version = createProfileVersion('/mock/profiles/team.json', operation, 'Bulk fill both');

      expect(version.profileFile).toBe('team.json');
      expect(version.source).toBe(PROFILE_VERSION_SOURCE.BULK);
      expect(version.operationSummary).toBe('Bulk fill both');
      expect(version.beforeRaw).toContain('old/model');
      expect(version.preview.models).toEqual({ 'sdd-init': 'old/model' });
      expect(version.preview.fallback).toEqual({ 'sdd-init': 'old/fallback' });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/config\/profile-versions\/team\.json\/\d{4}-/),
        expect.stringContaining('"beforeRaw"')
      );
    });

    it('normalizes legacy versions without source as bulk versions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 1,
        id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
        profileFile: 'team.json',
        createdAt: '2026-04-26T10:00:00.000Z',
        operation,
        operationSummary: 'Legacy bulk fill both',
        beforeRaw: '{"models":{"sdd-init":"old"}}',
        preview: { models: { 'sdd-init': 'old' }, fallback: {} }
      }));

      const version = readProfileVersion('team.json/2026-04-26T10-00-00-000Z-a.json');

      expect(version.source).toBe(PROFILE_VERSION_SOURCE.BULK);
      expect(version.operation).toEqual({
        source: PROFILE_VERSION_SOURCE.BULK,
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
      });
    });

    it('prunes profile versions to the newest 60 snapshots', () => {
      const existingFiles = Array.from({ length: 61 }, (_, index) => {
        const hour = String(index).padStart(2, '0');
        return `2026-04-26T${hour}-00-00-000Z-${index}.json`;
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(existingFiles as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: { 'sdd-init': 'old/model' }, fallback: {} }));

      createProfileVersion('/mock/profiles/team.json', operation, 'Bulk fill both');

      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith('/mock/config/profile-versions/team.json/2026-04-26T00-00-00-000Z-0.json');
    });

    it('lists newest versions and reads previews by safe version id', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['2026-04-26T10-00-00-000Z-a.json', '2026-04-26T11-00-00-000Z-b.json'] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => JSON.stringify({
        version: 1,
        id: String(filePath).includes('11-00') ? 'team.json/2026-04-26T11-00-00-000Z-b.json' : 'team.json/2026-04-26T10-00-00-000Z-a.json',
        profileFile: 'team.json',
        createdAt: String(filePath).includes('11-00') ? '2026-04-26T11:00:00.000Z' : '2026-04-26T10:00:00.000Z',
        operation,
        operationSummary: 'Bulk fill both',
        beforeRaw: '{"models":{"sdd-init":"old"}}',
        preview: { models: { 'sdd-init': 'old' }, fallback: {} }
      }));

      const versions = listProfileVersions('team.json');
      const read = readProfileVersion(versions[0].id);

      expect(versions.map((item) => item.createdAt)).toEqual(['2026-04-26T11:00:00.000Z', '2026-04-26T10:00:00.000Z']);
      expect(read.preview.models).toEqual({ 'sdd-init': 'old' });
      expect(() => readProfileVersion('../evil.json')).toThrow('Invalid profile version id');
    });

    it('skips corrupt version files instead of failing the entire list', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        '2026-04-26T10-00-00-000Z-good.json',
        '2026-04-26T11-00-00-000Z-bad.json',
      ] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('bad.json')) {
          return '{invalid json';
        }

        return JSON.stringify({
          version: 1,
          id: 'team.json/2026-04-26T10-00-00-000Z-good.json',
          profileFile: 'team.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          operation,
          operationSummary: 'Bulk fill both',
          beforeRaw: '{"models":{"sdd-init":"old"}}',
          preview: { models: { 'sdd-init': 'old' }, fallback: {} }
        });
      });

      expect(listProfileVersions('team.json')).toEqual([
        {
          version: 1,
          id: 'team.json/2026-04-26T10-00-00-000Z-good.json',
          profileFile: 'team.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          source: PROFILE_VERSION_SOURCE.BULK,
          operation: {
            source: PROFILE_VERSION_SOURCE.BULK,
            target: BULK_ASSIGNMENT_TARGET.BOTH,
            mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
          },
          operationSummary: 'Bulk fill both',
          preview: { models: { 'sdd-init': 'old' }, fallback: {} }
        }
      ]);
    });

    it('rejects malformed parseable version payloads and skips them from lists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        '2026-04-26T10-00-00-000Z-good.json',
        '2026-04-26T11-00-00-000Z-malformed.json',
      ] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('malformed.json')) {
          return JSON.stringify({
            version: 1,
            id: 'team.json/2026-04-26T11-00-00-000Z-malformed.json',
            profileFile: 'team.json',
            createdAt: null,
            source: PROFILE_VERSION_SOURCE.BULK,
            operation,
            operationSummary: 'Bulk fill both',
            beforeRaw: null,
            preview: null,
          });
        }

        return JSON.stringify({
          version: 1,
          id: 'team.json/2026-04-26T10-00-00-000Z-good.json',
          profileFile: 'team.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          operation,
          operationSummary: 'Bulk fill both',
          beforeRaw: '{"models":{"sdd-init":"old"}}',
          preview: { models: { 'sdd-init': 'old' }, fallback: {} }
        });
      });

      expect(() => readProfileVersion('team.json/2026-04-26T11-00-00-000Z-malformed.json')).toThrow('Invalid profile version data');
      expect(listProfileVersions('team.json')).toEqual([
        {
          version: 1,
          id: 'team.json/2026-04-26T10-00-00-000Z-good.json',
          profileFile: 'team.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          source: PROFILE_VERSION_SOURCE.BULK,
          operation: {
            source: PROFILE_VERSION_SOURCE.BULK,
            target: BULK_ASSIGNMENT_TARGET.BOTH,
            mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
          },
          operationSummary: 'Bulk fill both',
          preview: { models: { 'sdd-init': 'old' }, fallback: {} }
        }
      ]);
    });

    it('sanitizes preview maps for valid persisted versions so preview formatting stays safe', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 1,
        id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
        profileFile: 'team.json',
        createdAt: '2026-04-26T10:00:00.000Z',
        operation,
        operationSummary: 'Bulk fill both',
        beforeRaw: '{"models":{"sdd-init":"old"}}',
        preview: {
          models: { 'sdd-init': 'old', 'sdd-apply': 42, random: 'ignored' },
          fallback: { 'sdd-init': 'fallback', 'sdd-design': null, random: 'ignored' }
        }
      }));

      const version = readProfileVersion('team.json/2026-04-26T10-00-00-000Z-a.json');

      expect(version.preview).toEqual({
        models: { 'sdd-init': 'old' },
        fallback: { 'sdd-init': 'fallback' }
      });
      expect(() => formatProfileVersionPreviewLines(version)).not.toThrow();
    });

    it('restores only the selected profile from version raw content after snapshotting the live profile', () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => String(filePath).includes('/profile-versions/team.json'));
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('/profile-versions/team.json/')) {
          return JSON.stringify({
            version: 1,
            id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
            profileFile: 'team.json',
            createdAt: '2026-04-26T10:00:00.000Z',
            operation,
            operationSummary: 'Bulk fill both',
            beforeRaw: '{"models":{"sdd-init":"old/model"}}',
            preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
          });
        }

        return '{"models":{"sdd-init":"live/model"}}';
      });
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      const restored = restoreProfileVersion('team.json', 'team.json/2026-04-26T10-00-00-000Z-a.json');

      expect(restored.profileFile).toBe('team.json');
      expect(writes[0].filePath).toContain('/mock/config/profile-versions/team.json/');
      expect(writes[0].content).toContain('Snapshot before restoring 2026-04-26T10-00-00-000Z-a.json');
      expect(writes[0].content).toContain('live/model');
      expect(writes[1].filePath).toMatch(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/);
      expect(writes[1].content).toBe('{"models":{"sdd-init":"old/model"}}');
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/team.json'
      );
      expect(() => restoreProfileVersion('other.json', 'team.json/2026-04-26T10-00-00-000Z-a.json')).toThrow('does not match selected profile');
    });

    it('restores a valid selected version even when the current live profile JSON is corrupt', () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => String(filePath).includes('/profile-versions/team.json'));
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('/profile-versions/team.json/')) {
          return JSON.stringify({
            version: 1,
            id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
            profileFile: 'team.json',
            createdAt: '2026-04-26T10:00:00.000Z',
            operation,
            operationSummary: 'Bulk fill both',
            beforeRaw: '{"models":{"sdd-init":"old/model"}}',
            preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
          });
        }

        return '{invalid current profile';
      });
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      expect(() => restoreProfileVersion('team.json', 'team.json/2026-04-26T10-00-00-000Z-a.json')).not.toThrow();
      expect(writes[0].filePath).toContain('/mock/config/profile-versions/team.json/');
      expect(writes[0].content).toContain('"beforeRaw": "{invalid current profile"');
      expect(writes[0].content).toContain('"preview": {\n    "models": {},\n    "fallback": {}\n  }');
      expect(writes[1].filePath).toMatch(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/);
      expect(writes[1].content).toBe('{"models":{"sdd-init":"old/model"}}');
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/team.json'
      );
    });

    it('restores raw snapshot content even when beforeRaw is invalid JSON', () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => String(filePath).includes('/profile-versions/team.json'));
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('/profile-versions/team.json/')) {
          return JSON.stringify({
            version: 1,
            id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
            profileFile: 'team.json',
            createdAt: '2026-04-26T10:00:00.000Z',
            operation,
            operationSummary: 'Bulk fill both',
            beforeRaw: '{invalid snapshot payload',
            preview: { models: {}, fallback: {} }
          });
        }

        return '{"models":{"sdd-init":"live/model"}}';
      });
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      expect(() => restoreProfileVersion('team.json', 'team.json/2026-04-26T10-00-00-000Z-a.json')).not.toThrow();
      expect(writes[1].filePath).toMatch(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/);
      expect(writes[1].content).toBe('{invalid snapshot payload');
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/team.json'
      );
    });

    it('creates a version before mutating bulk write and skips versioning for no-op or validation failure', () => {
      const writes: string[] = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: { 'sdd-init': '' }, fallback: {} }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any) => { writes.push(String(filePath)); });

      const result = updateProfileWithBulkPhaseAssignment('/mock/profiles/team.json', ['sdd-init'], 'provider/model', operation);

      expect(result.assignment.changed).toBe(true);
      expect(writes[0]).toContain('/mock/config/profile-versions/team.json/');
      expect(writes[1]).toMatch(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/);
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/team.json'
      );

      vi.clearAllMocks();
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: { 'sdd-init': 'existing' }, fallback: { 'sdd-init': 'existing' } }));
      const noOp = updateProfileWithBulkPhaseAssignment('/mock/profiles/team.json', ['sdd-init'], 'provider/model', operation);
      expect(noOp.assignment.changed).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      expect(() => updateProfileWithBulkPhaseAssignment('/mock/profiles/team.json', ['sdd-init'], ' ', operation)).toThrow('modelId must be a non-empty string');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('reuses already-read profile raw when creating bulk version snapshots', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: { 'sdd-init': '' }, fallback: {} }));

      updateProfileWithBulkPhaseAssignment('/mock/profiles/team.json', ['sdd-init'], 'provider/model', operation);

      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('uses runtime policy for bulk updates so updated runtimes persist gentle-orchestrator only', () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: {
          'sdd-orchestrator': 'legacy/orchestrator',
          'sdd-init': '',
        },
        fallback: {},
      }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      const updatedPolicy = getOrchestratorPolicy(['gentle-orchestrator', 'sdd-init']);
      updateProfileWithBulkPhaseAssignment(
        '/mock/profiles/team.json',
        ['sdd-init'],
        'provider/model',
        operation,
        updatedPolicy as any,
      );

      const profileWrite = writes.find((write) => /^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/.test(write.filePath));
      expect(profileWrite).toBeDefined();
      const persistedProfile = JSON.parse(profileWrite!.content);
      expect(persistedProfile.models['gentle-orchestrator']).toBe('legacy/orchestrator');
      expect(persistedProfile.models['sdd-orchestrator']).toBeUndefined();
    });

    it('creates a phase source version before mutating a single primary phase model', () => {
      const writes: string[] = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-design': 'old/model' },
        fallback: { 'sdd-design': 'old/fallback' },
        description: 'team defaults'
      }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any) => { writes.push(String(filePath)); });

      const result = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'primary', 'new/model');

      expect(result.changed).toBe(true);
      expect(result.version?.source).toBe(PROFILE_VERSION_SOURCE.PHASE);
      expect(result.version?.operation).toEqual({
        source: PROFILE_VERSION_SOURCE.PHASE,
        phase: 'sdd-design',
        field: 'primary',
        modelId: 'new/model',
        changedPhases: 1,
      });
      expect(result.version?.operationSummary).toBe('Set sdd-design primary model to new/model');
      expect(result.profile.models['sdd-design']).toBe('new/model');
      expect(result.profile.fallback?.['sdd-design']).toBe('old/fallback');
      expect((result.profile as any).description).toBe('team defaults');
      expect(writes[0]).toContain('/mock/config/profile-versions/team.json/');
      expect(writes[1]).toMatch(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/);
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/),
        '/mock/profiles/team.json'
      );
    });

    it('does not persist version metadata in the profile payload for phase model updates', () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-design': 'old/model' },
        fallback: { 'sdd-design': 'old/fallback' },
        description: 'team defaults'
      }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'primary', 'new/model');

      const profileWrite = writes.find((write) => /^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/.test(write.filePath));
      expect(profileWrite).toBeDefined();

      const persistedProfile = JSON.parse(profileWrite!.content);
      expect(persistedProfile).toEqual({
        models: { 'sdd-design': 'new/model' },
        fallback: { 'sdd-design': 'old/fallback' },
        description: 'team defaults'
      });
      expect(persistedProfile).not.toHaveProperty('source');
      expect(persistedProfile).not.toHaveProperty('operation');
      expect(persistedProfile).not.toHaveProperty('operationSummary');
      expect(persistedProfile).not.toHaveProperty('beforeRaw');
    });

    it('uses UI-derived runtime policy for detail edits so updated runtimes persist gentle-orchestrator only', () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: {
          'sdd-design': 'old/model',
          'sdd-orchestrator': 'legacy/orchestrator'
        }
      }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      const updatedPolicy = resolveRuntimeOrchestratorPolicy({
        default_agent: 'gentle-orchestrator',
        agent: {
          'gentle-orchestrator': { model: 'runtime/model' },
          'sdd-design': { model: 'design/model' },
        },
      } as any);
      updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'primary', 'new/model', updatedPolicy as any);

      const profileWrite = writes.find((write) => /^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/.test(write.filePath));
      expect(profileWrite).toBeDefined();

      const persistedProfile = JSON.parse(profileWrite!.content);
      expect(persistedProfile.models['gentle-orchestrator']).toBe('legacy/orchestrator');
      expect(persistedProfile.models['sdd-orchestrator']).toBeUndefined();
    });

    it('creates a phase source version before mutating a single fallback phase model', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-apply': 'old/model' },
        fallback: { 'sdd-apply': 'old/fallback' }
      }));

      const result = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-apply', 'fallback', 'new/fallback');

      expect(result.changed).toBe(true);
      expect(result.version?.source).toBe(PROFILE_VERSION_SOURCE.PHASE);
      expect(result.version?.operationSummary).toBe('Set sdd-apply fallback model to new/fallback');
      expect(result.profile.models['sdd-apply']).toBe('old/model');
      expect(result.profile.fallback?.['sdd-apply']).toBe('new/fallback');
    });

    it('skips versioning and profile writes for no-op single phase model updates', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-design': 'new/model' },
        fallback: { 'sdd-design': 'new/fallback' }
      }));

      const primaryNoOp = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'primary', 'new/model');
      const fallbackNoOp = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'fallback', 'new/fallback');

      expect(primaryNoOp.changed).toBe(false);
      expect(fallbackNoOp.changed).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('renames matching profile version history with migrated snapshot metadata', () => {
      const files: Record<string, string> = {
        '/mock/profiles/old.json': '{"models":{"sdd-init":"live/model"}}',
        '/mock/config/profile-versions/old.json/2026-04-26T10-00-00-000Z-a.json': JSON.stringify({
          version: 1,
          id: 'old.json/2026-04-26T10-00-00-000Z-a.json',
          profileFile: 'old.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          operation,
          operationSummary: 'Bulk fill both',
          beforeRaw: '{"models":{"sdd-init":"old/model"}}',
          preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
        })
      };

      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
        const target = String(filePath);
        if (target in files) return true;
        return Object.keys(files).some((existingPath) => existingPath.startsWith(`${target}/`));
      });
      vi.mocked(fs.readdirSync).mockImplementation((dirPath: any) => {
        const target = `${String(dirPath)}/`;
        return Object.keys(files)
          .filter((filePath) => filePath.startsWith(target))
          .map((filePath) => filePath.slice(target.length))
          .filter((entry) => !entry.includes('/')) as any;
      });
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => files[String(filePath)]);
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        files[String(filePath)] = String(content);
      });
      vi.mocked(fs.renameSync).mockImplementation((fromPath: any, toPath: any) => {
        const from = String(fromPath);
        const to = String(toPath);

        if (from in files) {
          files[to] = files[from];
          delete files[from];
          return;
        }

        const prefix = `${from}/`;
        for (const filePath of Object.keys(files)) {
          if (!filePath.startsWith(prefix)) continue;
          const nextPath = `${to}/${filePath.slice(prefix.length)}`;
          files[nextPath] = files[filePath];
          delete files[filePath];
        }
      });

      renameProfileFile('old.json', 'new.json');

      const versions = listProfileVersions('new.json');
      const read = readProfileVersion('new.json/2026-04-26T10-00-00-000Z-a.json');

      expect(versions).toEqual([
        {
          version: 1,
          id: 'new.json/2026-04-26T10-00-00-000Z-a.json',
          profileFile: 'new.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          source: PROFILE_VERSION_SOURCE.BULK,
          operation: {
            source: PROFILE_VERSION_SOURCE.BULK,
            target: BULK_ASSIGNMENT_TARGET.BOTH,
            mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
          },
          operationSummary: 'Bulk fill both',
          preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
        }
      ]);
      expect(read.id).toBe('new.json/2026-04-26T10-00-00-000Z-a.json');
      expect(read.profileFile).toBe('new.json');
      expect(fs.renameSync).toHaveBeenCalledWith('/mock/profiles/old.json', '/mock/profiles/new.json');
      expect(fs.renameSync).toHaveBeenCalledWith('/mock/config/profile-versions/old.json', '/mock/config/profile-versions/new.json');
    });

    it('renames the profile and preserves corrupt version files without blocking valid snapshot migration', () => {
      const files: Record<string, string> = {
        '/mock/profiles/old.json': '{"models":{"sdd-init":"live/model"}}',
        '/mock/config/profile-versions/old.json/2026-04-26T10-00-00-000Z-good.json': JSON.stringify({
          version: 1,
          id: 'old.json/2026-04-26T10-00-00-000Z-good.json',
          profileFile: 'old.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          operation,
          operationSummary: 'Bulk fill both',
          beforeRaw: '{"models":{"sdd-init":"old/model"}}',
          preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
        }),
        '/mock/config/profile-versions/old.json/2026-04-26T11-00-00-000Z-bad.json': '{invalid json'
      };

      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
        const target = String(filePath);
        if (target in files) return true;
        return Object.keys(files).some((existingPath) => existingPath.startsWith(`${target}/`));
      });
      vi.mocked(fs.readdirSync).mockImplementation((dirPath: any) => {
        const target = `${String(dirPath)}/`;
        return Object.keys(files)
          .filter((filePath) => filePath.startsWith(target))
          .map((filePath) => filePath.slice(target.length))
          .filter((entry) => !entry.includes('/')) as any;
      });
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => files[String(filePath)]);
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        files[String(filePath)] = String(content);
      });
      vi.mocked(fs.renameSync).mockImplementation((fromPath: any, toPath: any) => {
        const from = String(fromPath);
        const to = String(toPath);

        if (from in files) {
          files[to] = files[from];
          delete files[from];
          return;
        }

        const prefix = `${from}/`;
        for (const filePath of Object.keys(files)) {
          if (!filePath.startsWith(prefix)) continue;
          const nextPath = `${to}/${filePath.slice(prefix.length)}`;
          files[nextPath] = files[filePath];
          delete files[filePath];
        }
      });

      renameProfileFile('old.json', 'new.json');

      expect(listProfileVersions('new.json')).toEqual([
        {
          version: 1,
          id: 'new.json/2026-04-26T10-00-00-000Z-good.json',
          profileFile: 'new.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          source: PROFILE_VERSION_SOURCE.BULK,
          operation: {
            source: PROFILE_VERSION_SOURCE.BULK,
            target: BULK_ASSIGNMENT_TARGET.BOTH,
            mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
          },
          operationSummary: 'Bulk fill both',
          preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
        }
      ]);
      expect(files['/mock/config/profile-versions/new.json/2026-04-26T11-00-00-000Z-bad.json']).toBe('{invalid json');
      expect(files['/mock/config/profile-versions/new.json/2026-04-26T10-00-00-000Z-good.json']).toContain('"id": "new.json/2026-04-26T10-00-00-000Z-good.json"');
    });

    it('rolls back the profile rename if version history rename fails', () => {
      const files: Record<string, string> = {
        '/mock/profiles/old.json': '{"models":{"sdd-init":"live/model"}}',
        '/mock/config/profile-versions/old.json/2026-04-26T10-00-00-000Z-a.json': JSON.stringify({
          version: 1,
          id: 'old.json/2026-04-26T10-00-00-000Z-a.json',
          profileFile: 'old.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          operation,
          operationSummary: 'Bulk fill both',
          beforeRaw: '{"models":{"sdd-init":"old/model"}}',
          preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
        })
      };

      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
        const target = String(filePath);
        if (target in files) return true;
        return Object.keys(files).some((existingPath) => existingPath.startsWith(`${target}/`));
      });
      vi.mocked(fs.readdirSync).mockImplementation((dirPath: any) => {
        const target = `${String(dirPath)}/`;
        return Object.keys(files)
          .filter((filePath) => filePath.startsWith(target))
          .map((filePath) => filePath.slice(target.length))
          .filter((entry) => !entry.includes('/')) as any;
      });
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => files[String(filePath)]);
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        files[String(filePath)] = String(content);
      });
      vi.mocked(fs.renameSync).mockImplementation((fromPath: any, toPath: any) => {
        const from = String(fromPath);
        const to = String(toPath);

        if (from === '/mock/config/profile-versions/old.json' && to === '/mock/config/profile-versions/new.json') {
          throw new Error('version rename failed');
        }

        if (from in files) {
          files[to] = files[from];
          delete files[from];
          return;
        }

        const prefix = `${from}/`;
        for (const filePath of Object.keys(files)) {
          if (!filePath.startsWith(prefix)) continue;
          const nextPath = `${to}/${filePath.slice(prefix.length)}`;
          files[nextPath] = files[filePath];
          delete files[filePath];
        }
      });

      expect(() => renameProfileFile('old.json', 'new.json')).toThrow('version rename failed');
      expect(files['/mock/profiles/old.json']).toBe('{"models":{"sdd-init":"live/model"}}');
      expect(files['/mock/profiles/new.json']).toBeUndefined();
    });

    it('rolls back rewritten version metadata if migration fails mid-rewrite', () => {
      const files: Record<string, string> = {
        '/mock/profiles/old.json': '{"models":{"sdd-init":"live/model"}}',
        '/mock/config/profile-versions/old.json/2026-04-26T10-00-00-000Z-a.json': JSON.stringify({
          version: 1,
          id: 'old.json/2026-04-26T10-00-00-000Z-a.json',
          profileFile: 'old.json',
          createdAt: '2026-04-26T10:00:00.000Z',
          operation,
          operationSummary: 'Bulk fill both',
          beforeRaw: '{"models":{"sdd-init":"old/model"}}',
          preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
        }),
        '/mock/config/profile-versions/old.json/2026-04-26T11-00-00-000Z-b.json': JSON.stringify({
          version: 1,
          id: 'old.json/2026-04-26T11-00-00-000Z-b.json',
          profileFile: 'old.json',
          createdAt: '2026-04-26T11:00:00.000Z',
          operation,
          operationSummary: 'Bulk fill both again',
          beforeRaw: '{"models":{"sdd-init":"older/model"}}',
          preview: { models: { 'sdd-init': 'older/model' }, fallback: {} }
        })
      };

      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
        const target = String(filePath);
        if (target in files) return true;
        return Object.keys(files).some((existingPath) => existingPath.startsWith(`${target}/`));
      });
      vi.mocked(fs.readdirSync).mockImplementation((dirPath: any) => {
        const target = `${String(dirPath)}/`;
        return Object.keys(files)
          .filter((filePath) => filePath.startsWith(target))
          .map((filePath) => filePath.slice(target.length))
          .filter((entry) => !entry.includes('/')) as any;
      });
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => files[String(filePath)]);
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        files[String(filePath)] = String(content);
      });
      vi.mocked(fs.renameSync).mockImplementation((fromPath: any, toPath: any) => {
        const from = String(fromPath);
        const to = String(toPath);

        if (from.includes('2026-04-26T11-00-00-000Z-b.json.tmp-') && to.endsWith('/2026-04-26T11-00-00-000Z-b.json')) {
          throw new Error('version rewrite failed');
        }

        if (from in files) {
          files[to] = files[from];
          delete files[from];
          return;
        }

        const prefix = `${from}/`;
        for (const filePath of Object.keys(files)) {
          if (!filePath.startsWith(prefix)) continue;
          const nextPath = `${to}/${filePath.slice(prefix.length)}`;
          files[nextPath] = files[filePath];
          delete files[filePath];
        }
      });

      expect(() => renameProfileFile('old.json', 'new.json')).toThrow('version rewrite failed');
      expect(files['/mock/profiles/old.json']).toBe('{"models":{"sdd-init":"live/model"}}');
      expect(files['/mock/profiles/new.json']).toBeUndefined();
      const directVersionWrites = vi.mocked(fs.writeFileSync).mock.calls
        .map(([filePath]) => String(filePath))
        .filter((filePath) => filePath.startsWith('/mock/config/profile-versions/new.json/') && filePath.endsWith('.json'));
      expect(directVersionWrites).toEqual([]);

      const firstVersion = readProfileVersion('old.json/2026-04-26T10-00-00-000Z-a.json');
      const secondVersion = readProfileVersion('old.json/2026-04-26T11-00-00-000Z-b.json');

      expect(firstVersion.id).toBe('old.json/2026-04-26T10-00-00-000Z-a.json');
      expect(firstVersion.profileFile).toBe('old.json');
      expect(secondVersion.id).toBe('old.json/2026-04-26T11-00-00-000Z-b.json');
      expect(secondVersion.profileFile).toBe('old.json');
      expect(files['/mock/config/profile-versions/new.json/2026-04-26T10-00-00-000Z-a.json']).toBeUndefined();
    });

    it('reports invalid profile version data when version file JSON is corrupt', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{invalid json');

      expect(() => readProfileVersion('team.json/2026-04-26T10-00-00-000Z-a.json')).toThrow('Invalid profile version data');
    });

    it('deletes matching profile version history with the profile file', () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => String(filePath) === '/mock/config/profile-versions/team.json');

      deleteProfileFile('team.json');

      expect(fs.unlinkSync).toHaveBeenCalledWith('/mock/profiles/team.json');
      expect(fs.rmSync).toHaveBeenCalledWith('/mock/config/profile-versions/team.json', { recursive: true, force: true });
    });
  });

  describe('activateProfileFile', () => {
    it('eagerly migrates profile files on updated runtime policy at startup', () => {
      const writes: string[] = [];
      vi.mocked(fs.readdirSync).mockReturnValue(['team.json'] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/team.json') {
          return JSON.stringify({
            models: {
              'sdd-orchestrator': 'legacy/model',
              'sdd-init': 'phase/model',
            },
          });
        }
        return '{}';
      });
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push(String(content));
        return undefined as any;
      });

      const migrated = migrateProfilesForRuntimePolicy(getOrchestratorPolicy(['gentle-orchestrator', 'sdd-init']));

      expect(migrated).toEqual(['team.json']);
      expect(writes).toHaveLength(1);
      const persisted = JSON.parse(writes[0]!);
      expect(persisted.models['gentle-orchestrator']).toBe('legacy/model');
      expect(persisted.models['sdd-orchestrator']).toBeUndefined();
    });

    it('does not migrate profile files when runtime policy is legacy', () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['team.json'] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: {
          'sdd-orchestrator': 'legacy/model',
          'sdd-init': 'phase/model',
        },
      }));

      const migrated = migrateProfilesForRuntimePolicy(getOrchestratorPolicy(['sdd-orchestrator', 'sdd-init']));

      expect(migrated).toEqual([]);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.renameSync).not.toHaveBeenCalled();
    });

    it('detects migrated profile as active after eager startup migration', () => {
      let profileRaw = JSON.stringify({
        models: {
          'sdd-orchestrator': 'legacy/model',
          'sdd-init': 'phase/model',
        },
      });
      vi.mocked(fs.readdirSync).mockReturnValue(['team.json'] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/team.json') return profileRaw;
        return '{}';
      });
      vi.mocked(fs.writeFileSync).mockImplementation((_filePath: any, content: any) => {
        profileRaw = String(content);
        return undefined as any;
      });

      migrateProfilesForRuntimePolicy(getOrchestratorPolicy(['gentle-orchestrator', 'sdd-init']));

      const api = {
        state: {
          config: {
            default_agent: 'gentle-orchestrator',
            agent: {
              'gentle-orchestrator': { model: 'legacy/model' },
              'sdd-init': { model: 'phase/model' },
            },
          },
        },
      } as any;

      expect(detectActiveProfileFile(['team.json'], api)).toBe('team.json');
    });

    it('matches legacy active profile during list detection without creating updated key side effects', () => {
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/legacy.json') {
          return JSON.stringify({ models: { 'sdd-orchestrator': 'legacy/model', 'sdd-init': 'phase/model' } });
        }
        return '{}';
      });

      const api = {
        state: {
          config: {
            default_agent: 'sdd-orchestrator',
            agent: {
              'sdd-orchestrator': { model: 'legacy/model' },
              'sdd-init': { model: 'phase/model' },
            },
          },
        },
      } as any;

      const active = detectActiveProfileFile(['legacy.json'], api);

      expect(active).toBe('legacy.json');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.renameSync).not.toHaveBeenCalled();
    });

    it('marks profile active when profile primaries are a subset of active config models', () => {
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/subset.json') {
          return JSON.stringify({ models: { 'sdd-init': 'phase/model' } });
        }
        return '{}';
      });

      const api = {
        state: {
          config: {
            default_agent: 'sdd-orchestrator',
            agent: {
              'sdd-orchestrator': { model: 'runtime/model' },
              'sdd-init': { model: 'phase/model' },
              'sdd-apply': { model: 'extra/model' },
            },
          },
        },
      } as any;

      expect(detectActiveProfileFile(['subset.json'], api)).toBe('subset.json');
    });

    it('does not require exact key-count equality when all declared profile primaries match', () => {
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/team.json') {
          return JSON.stringify({ models: { 'sdd-orchestrator': 'runtime/model', 'sdd-init': 'phase/model' } });
        }
        return '{}';
      });

      const api = {
        state: {
          config: {
            default_agent: 'sdd-orchestrator',
            agent: {
              'sdd-orchestrator': { model: 'runtime/model' },
              'sdd-init': { model: 'phase/model' },
              'sdd-apply': { model: 'apply/model' },
              'sdd-plan': { model: 'plan/model' },
            },
          },
        },
      } as any;

      expect(detectActiveProfileFile(['team.json'], api)).toBe('team.json');
    });

    it('uses fallback model comparison as tie-breaker when primaries match multiple profiles', () => {
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/alpha.json') {
          return JSON.stringify({
            models: { 'sdd-init': 'phase/model' },
            fallback: { 'sdd-init': 'fallback/a' },
          });
        }
        if (String(filePath) === '/mock/profiles/beta.json') {
          return JSON.stringify({
            models: { 'sdd-init': 'phase/model' },
            fallback: { 'sdd-init': 'fallback/b' },
          });
        }
        return '{}';
      });

      const api = {
        state: {
          config: {
            default_agent: 'sdd-orchestrator',
            agent: {
              'sdd-orchestrator': { model: 'runtime/model' },
              'sdd-init': { model: 'phase/model' },
              'sdd-init-fallback': { model: 'fallback/b' },
            },
          },
        },
      } as any;

      expect(detectActiveProfileFile(['alpha.json', 'beta.json'], api)).toBe('beta.json');
    });

    it('returns undefined when tie remains unresolved after fallback comparison', () => {
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/alpha.json') {
          return JSON.stringify({
            models: { 'sdd-init': 'phase/model' },
            fallback: { 'sdd-init': 'fallback/shared' },
          });
        }
        if (String(filePath) === '/mock/profiles/beta.json') {
          return JSON.stringify({
            models: { 'sdd-init': 'phase/model' },
            fallback: { 'sdd-init': 'fallback/shared' },
          });
        }
        return '{}';
      });

      const api = {
        state: {
          config: {
            default_agent: 'sdd-orchestrator',
            agent: {
              'sdd-orchestrator': { model: 'runtime/model' },
              'sdd-init': { model: 'phase/model' },
              'sdd-init-fallback': { model: 'fallback/shared' },
            },
          },
        },
      } as any;

      expect(detectActiveProfileFile(['alpha.json', 'beta.json'], api)).toBeUndefined();
    });

    it('keeps sdd-orchestrator during activation in legacy runtime and does not create gentle-orchestrator', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => String(filePath) === '/mock/config/opencode.json');
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/team.json') {
          return JSON.stringify({
            models: {
              'sdd-orchestrator': 'legacy/model',
              'sdd-init': 'phase/model',
            },
          });
        }

        return JSON.stringify({
          default_agent: 'sdd-orchestrator',
          agent: {
            'sdd-orchestrator': { model: 'legacy/old' },
            'sdd-init': { model: 'phase/old' },
          },
        });
      });

      const update = vi.fn().mockResolvedValue({ data: {} });
      const api = {
        ui: { toast: vi.fn() },
        client: {
          global: {
            config: {
              get: vi.fn(),
              update,
            },
          },
        },
      } as any;

      await activateProfileFile(api, '/mock/profiles/team.json', 'team');

      const payload = update.mock.calls[0]?.[0]?.config;
      expect(payload.agent['sdd-orchestrator']?.model).toBe('legacy/model');
      expect(payload.agent['gentle-orchestrator']).toBeUndefined();
    });

    it('preserves canonical gentle-orchestrator across bulk update then activation in updated runtime', async () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      const bulkOperation = {
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
      } as const;
      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => String(filePath) === '/mock/config/opencode.json');
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/team.json') {
          return JSON.stringify({
            models: {
              'sdd-orchestrator': 'legacy/model',
              'sdd-init': '',
            },
            fallback: {},
          });
        }

        return JSON.stringify({
          default_agent: 'gentle-orchestrator',
          agent: {
            'gentle-orchestrator': { model: 'runtime/old' },
            'sdd-init': { model: 'phase/old' },
          },
        });
      });
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      const updatedPolicy = getOrchestratorPolicy(['gentle-orchestrator', 'sdd-init']);
      updateProfileWithBulkPhaseAssignment(
        '/mock/profiles/team.json',
        ['sdd-init'],
        'provider/model',
        bulkOperation,
        updatedPolicy as any,
      );

      const update = vi.fn().mockResolvedValue({ data: {} });
      const api = {
        ui: { toast: vi.fn() },
        client: {
          global: {
            config: {
              get: vi.fn(),
              update,
            },
          },
        },
      } as any;

      await activateProfileFile(api, '/mock/profiles/team.json', 'team');

      const profileWrite = writes.find((write) => /^\/mock\/profiles\/team\.json\.tmp-[0-9a-f]{8}$/.test(write.filePath));
      expect(profileWrite).toBeDefined();
      const persistedProfile = JSON.parse(profileWrite!.content);
      expect(persistedProfile.models['gentle-orchestrator']).toBe('legacy/model');
      expect(persistedProfile.models['sdd-orchestrator']).toBeUndefined();

      const payload = update.mock.calls[0]?.[0]?.config;
      expect(payload.agent['gentle-orchestrator']?.model).toBe('legacy/model');
      expect(payload.agent['sdd-orchestrator']).toBeUndefined();
    });

    it('returns null and shows toast when on-disk global config JSON is invalid', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath: any) => String(filePath) === '/mock/config/opencode.json');
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath) === '/mock/profiles/team.json') {
          return JSON.stringify({ models: { 'sdd-init': 'gpt-4' } });
        }

        return '{invalid global config json';
      });

      const toast = vi.fn();
      const api = {
        ui: { toast },
        client: {
          global: {
            config: {
              get: vi.fn(),
              update: vi.fn(),
            },
          },
        },
      } as any;

      const result = await activateProfileFile(api, '/mock/profiles/team.json', 'team');

      expect(result).toBeNull();
      expect(api.client.global.config.update).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Activation Failed',
        variant: 'error',
      }));
    });
  });
});
