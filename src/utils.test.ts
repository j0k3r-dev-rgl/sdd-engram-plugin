import { describe, it, expect, vi } from 'vitest';
import {
  formatContext,
  formatMemoryDate,
  truncateText,
  isManagedSddAgent,
  isSddFallbackAgent,
  isPrimarySddAgent,
  isFallbackEligibleSddAgent,
  resolveModelInfo,
  parseActiveProfileFromRaw,
} from './utils';

describe('utils logic', () => {
  describe('formatContext', () => {
    it('should handle null or non-number', () => {
      expect(formatContext(null)).toBe('ctx: N/A');
      expect(formatContext('128000' as any)).toBe('ctx: N/A');
    });

    it('should format millions', () => {
      expect(formatContext(1000000)).toBe('1M ctx');
      expect(formatContext(1500000)).toBe('1.5M ctx');
      expect(formatContext(2000000)).toBe('2M ctx');
    });

    it('should format thousands', () => {
      expect(formatContext(128000)).toBe('128k ctx');
      expect(formatContext(8192)).toBe('8k ctx');
    });

    it('should format small numbers', () => {
      expect(formatContext(512)).toBe('512 ctx');
    });
  });

  describe('formatMemoryDate', () => {
    it('should handle undefined', () => {
      expect(formatMemoryDate(undefined)).toBe('No date');
    });

    it('should handle invalid dates', () => {
      expect(formatMemoryDate('not-a-date')).toBe('not-a-date');
    });

    it('should format valid dates', () => {
      const iso = '2023-01-01T12:00:00Z';
      const formatted = formatMemoryDate(iso);
      expect(formatted).not.toBe(iso);
      expect(formatted).not.toBe('No date');
      // toLocaleString varies by environment, so we just check it's not the raw string
    });
  });

  describe('truncateText', () => {
    it('should handle empty or null', () => {
      expect(truncateText('')).toBe('');
      expect(truncateText(null as any)).toBe('');
    });

    it('should not truncate short text', () => {
      expect(truncateText('short', 10)).toBe('short');
    });

    it('should truncate long text', () => {
      expect(truncateText('this is a very long text', 10)).toBe('this is a…');
    });

    it('should use default max', () => {
      const long = 'a'.repeat(121);
      const truncated = truncateText(long);
      expect(truncated.length).toBe(120);
      expect(truncated.endsWith('…')).toBe(true);
    });
  });

  describe('agent naming utils', () => {
    it('isManagedSddAgent', () => {
      expect(isManagedSddAgent('sdd-test')).toBe(true);
      expect(isManagedSddAgent('gentle-orchestrator')).toBe(true);
      expect(isManagedSddAgent('other-test')).toBe(false);
    });

    it('isSddFallbackAgent', () => {
      expect(isSddFallbackAgent('sdd-test-fallback')).toBe(true);
      expect(isSddFallbackAgent('sdd-test')).toBe(false);
      expect(isSddFallbackAgent('other-fallback')).toBe(false);
    });

    it('isPrimarySddAgent', () => {
      expect(isPrimarySddAgent('sdd-test')).toBe(true);
      expect(isPrimarySddAgent('gentle-orchestrator')).toBe(true);
      expect(isPrimarySddAgent('sdd-test-fallback')).toBe(false);
      expect(isPrimarySddAgent('other-test')).toBe(false);
    });

    it('isFallbackEligibleSddAgent', () => {
      expect(isFallbackEligibleSddAgent('sdd-test')).toBe(true);
      expect(isFallbackEligibleSddAgent('sdd-orchestrator')).toBe(false);
      expect(isFallbackEligibleSddAgent('gentle-orchestrator')).toBe(false);
      expect(isFallbackEligibleSddAgent('sdd-test-fallback')).toBe(false);
      expect(isFallbackEligibleSddAgent('other-test')).toBe(false);
    });
  });

  describe('resolveModelInfo', () => {
    it('should handle unassigned model', () => {
      expect(resolveModelInfo({}, '')).toBe('Unassigned');
    });

    it('should resolve model info with context', () => {
      const api = {
        state: {
          provider: [
            {
              id: 'openai',
              models: {
                'gpt-4': {
                  limit: { context: 128000 }
                }
              }
            }
          ]
        }
      };
      expect(resolveModelInfo(api, 'openai/gpt-4')).toBe('openai/gpt-4 (128k ctx)');
    });

    it('should resolve model info without context', () => {
      const api = {
        state: {
          provider: [
            {
              id: 'openai',
              models: {
                'gpt-4': {}
              }
            }
          ]
        }
      };
      expect(resolveModelInfo(api, 'openai/gpt-4')).toBe('openai/gpt-4');
    });
  });

  describe('parseActiveProfileFromRaw', () => {
    const mockApi = {
      state: {
        provider: [
          {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-4': { name: 'GPT-4', limit: { context: 128000 } }
            }
          }
        ]
      }
    };

    it('should return null for invalid JSON', () => {
      expect(parseActiveProfileFromRaw('invalid', mockApi)).toBe(null);
    });

    it('should return null if no agents/models found', () => {
      expect(parseActiveProfileFromRaw('{}', mockApi)).toBe(null);
    });

    it('should parse valid agent config', () => {
      const raw = JSON.stringify({
        agent: {
          'sdd-test': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result).toEqual({
        modelId: 'openai/gpt-4',
        modelName: 'GPT-4',
        providerName: 'OpenAI',
        contextLimit: 128000
      });
    });

    it('should fallback to "model" key if "agent" is missing', () => {
      const raw = JSON.stringify({
        model: {
          'sdd-test': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result?.modelId).toBe('openai/gpt-4');
    });

    it('should handle missing provider gracefully', () => {
      const raw = JSON.stringify({
        agent: {
          'sdd-test': { model: 'anthropic/claude' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result).toEqual({
        modelId: 'anthropic/claude',
        modelName: 'claude',
        providerName: 'anthropic',
        contextLimit: null
      });
    });

    it('should prioritize managed SDD agents', () => {
      const raw = JSON.stringify({
        agent: {
          'other-agent': { model: 'openai/gpt-3.5' },
          'sdd-agent': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result?.modelId).toBe('openai/gpt-4');
    });

    it('should keep gentle-orchestrator model from migrated profile payloads', () => {
      const raw = JSON.stringify({
        agent: {
          'other-agent': { model: 'openai/gpt-3.5' },
          'gentle-orchestrator': { model: 'openai/gpt-4' }
        }
      });
      const result = parseActiveProfileFromRaw(raw, mockApi);
      expect(result?.modelId).toBe('openai/gpt-4');
    });

    it('should return null if agent has no model', () => {
        const raw = JSON.stringify({
          agent: {
            'sdd-test': {}
          }
        });
        expect(parseActiveProfileFromRaw(raw, mockApi)).toBe(null);
      });
  });
});
