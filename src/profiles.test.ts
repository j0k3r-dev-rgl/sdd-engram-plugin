import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { 
  extractSddAgentModels, 
  extractSddFallbackModels, 
  readProfileModels, 
  readProfileFallbackModels, 
  syncSddFallbackAgents, 
  validateProfileFallbackMapping,
  isSddProfile,
  applyProfileDataToConfig
} from './profiles';

vi.mock('node:fs');
vi.mock('./config', () => ({
  resolvePaths: () => ({
    profilesDir: '/mock/profiles',
    configRoot: '/mock/config',
    configPath: '/mock/config/opencode.json'
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
});
