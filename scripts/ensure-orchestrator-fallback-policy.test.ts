import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveDefaultConfigPath, 
  isFilePromptReference, 
  resolvePromptFilePath, 
  upsertFallbackPolicy,
  MARKER_START,
  MARKER_END,
  FALLBACK_POLICY_BLOCK,
  resolveCanonicalPromptAgentName
} from './ensure-orchestrator-fallback-policy';

vi.mock('node:os');

describe('ensure-orchestrator-fallback-policy logic', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveDefaultConfigPath', () => {
    it('should return default path using home directory', () => {
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');
      delete process.env.XDG_CONFIG_HOME;

      const expected = path.join('/home/testuser', '.config', 'opencode', 'opencode.json');
      expect(resolveDefaultConfigPath()).toBe(expected);
    });

    it('should respect XDG_CONFIG_HOME', () => {
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');
      process.env.XDG_CONFIG_HOME = '/custom/xdg';

      const expected = path.join('/custom/xdg', 'opencode', 'opencode.json');
      expect(resolveDefaultConfigPath()).toBe(expected);
    });
  });

  describe('isFilePromptReference', () => {
    it('should return true for valid {file:...} references', () => {
      expect(isFilePromptReference('{file:prompts/orch.md}')).toBe(true);
      expect(isFilePromptReference('  {file:/abs/path.md}  ')).toBe(true);
    });

    it('should return false for inline text', () => {
      expect(isFilePromptReference('Just some text')).toBe(false);
      expect(isFilePromptReference('file:no-braces.md')).toBe(false);
      expect(isFilePromptReference('{nofile:path.md}')).toBe(false);
    });
  });

  describe('resolvePromptFilePath', () => {
    const configPath = '/home/project/opencode.json';

    it('should resolve absolute paths', () => {
      const prompt = '{file:/etc/custom.md}';
      expect(resolvePromptFilePath(prompt, configPath)).toBe('/etc/custom.md');
    });

    it('should resolve relative paths against config directory', () => {
      const prompt = '{file:prompts/orch.md}';
      const expected = path.resolve('/home/project', 'prompts/orch.md');
      expect(resolvePromptFilePath(prompt, configPath)).toBe(expected);
    });

    it('should throw for empty path', () => {
      expect(() => resolvePromptFilePath('{file:}', configPath)).toThrow('empty path');
      expect(() => resolvePromptFilePath('{file:  }', configPath)).toThrow('empty path');
    });
  });

  describe('upsertFallbackPolicy', () => {
    it('should replace existing block if markers are present', () => {
      const oldBlock = `${MARKER_START}\nOld Policy\n${MARKER_END}`;
      const content = `Header\n\n${oldBlock}\n\nFooter`;
      
      const { updated, changed } = upsertFallbackPolicy(content);
      
      expect(changed).toBe(true);
      expect(updated).toContain(MARKER_START);
      expect(updated).toContain(MARKER_END);
      expect(updated).toContain('Sub-Agent Fallback Policy');
      expect(updated).not.toContain('Old Policy');
      expect(updated).toBe(`Header\n\n${FALLBACK_POLICY_BLOCK}\n\nFooter`);
    });

    it('should insert under ## SDD Workflow if section exists', () => {
      const content = `# Title\n\n## SDD Workflow\nRules here.`;
      const { updated, changed } = upsertFallbackPolicy(content);

      expect(changed).toBe(true);
      expect(updated).toContain('## SDD Workflow\n\n' + FALLBACK_POLICY_BLOCK);
    });

    it('should append to end if no section or markers exist', () => {
      const content = `Some random prompt text.`;
      const { updated, changed } = upsertFallbackPolicy(content);

      expect(changed).toBe(true);
      expect(updated).toBe(`Some random prompt text.\n\n${FALLBACK_POLICY_BLOCK}\n`);
    });

    it('should be idempotent (return changed: false if already present)', () => {
      const initial = `Prompt text.\n\n${FALLBACK_POLICY_BLOCK}\n`;
      const { updated, changed } = upsertFallbackPolicy(initial);

      expect(changed).toBe(false);
      expect(updated).toBe(initial);
    });

    it('should handle missing trailing newline when appending', () => {
        const content = `No newline`;
        const { updated } = upsertFallbackPolicy(content);
        expect(updated).toBe(`No newline\n\n${FALLBACK_POLICY_BLOCK}\n`);
    });
  });

  describe('resolveCanonicalPromptAgentName', () => {
    it('prefers gentle-orchestrator when present', () => {
      const config = {
        agent: {
          'sdd-orchestrator': { prompt: 'legacy' },
          'gentle-orchestrator': { prompt: 'updated' },
        },
      };

      expect(resolveCanonicalPromptAgentName(config)).toBe('gentle-orchestrator');
    });

    it('falls back to sdd-orchestrator for legacy configs', () => {
      const config = {
        agent: {
          'sdd-orchestrator': { prompt: 'legacy' },
        },
      };

      expect(resolveCanonicalPromptAgentName(config)).toBe('sdd-orchestrator');
    });
  });
});
