import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import * as config from './config';
const { resolvePaths, resolveProjectCandidates, resolveProjectName, resolveWorkspaceRoot } = config;

vi.mock('node:os');
vi.mock('node:child_process');

describe('config logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolvePaths', () => {
    it('should resolve paths using default XDG (home/.config)', () => {
      vi.mocked(os.homedir).mockReturnValue('/home/user');
      const originalEnv = { ...process.env };
      delete process.env.XDG_CONFIG_HOME;

      try {
        const paths = resolvePaths();
        expect(paths.configRoot).toBe(path.join('/home/user', '.config', 'opencode'));
      } finally {
        process.env = originalEnv;
      }
    });

    it('should respect XDG_CONFIG_HOME override', () => {
      vi.mocked(os.homedir).mockReturnValue('/home/user');
      const originalEnv = { ...process.env };
      process.env.XDG_CONFIG_HOME = '/custom/config';

      try {
        const paths = resolvePaths();
        expect(paths.configRoot).toBe(path.join('/custom/config', 'opencode'));
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('resolveProjectCandidates', () => {
    it('should return all candidates (remote, root, directory)', () => {
      const api = { state: { path: { directory: '/path/to/my-repo' } } };
      
      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args: any) => {
        if (args?.includes('remote')) return 'https://github.com/org/my-repo.git';
        if (args?.includes('rev-parse')) return '/path/to/my-repo';
        return '';
      });

      const candidates = resolveProjectCandidates(api);
      expect(candidates).toContain('my-repo');
      expect(candidates.length).toBe(1); // deduplicated
    });

    it('should handle git failures gracefully', () => {
      const api = { state: { path: { directory: '/path/to/my-repo' } } };
      
      vi.mocked(child_process.execFileSync).mockImplementation(() => {
        throw new Error('Not a git repo');
      });

      const candidates = resolveProjectCandidates(api);
      expect(candidates).toEqual(['my-repo']); // only directory name fallback
    });
  });

  describe('resolveProjectName', () => {
    it('should return the first candidate', () => {
      const api = { state: { path: { directory: '/path/to/repo' } } };
      vi.mocked(child_process.execFileSync).mockImplementation((cmd, args: any) => {
        if (args?.includes('remote')) return 'repo-from-git';
        if (args?.includes('rev-parse')) return '/path/to/repo';
        return '';
      });
      
      const name = resolveProjectName(api);
      expect(name).toBe('repo-from-git');
    });
  });

  describe('resolveWorkspaceRoot', () => {
    it('should return api.state.path.directory', () => {
      const api = { state: { path: { directory: '/workspace/root' } } };
      expect(resolveWorkspaceRoot(api)).toBe('/workspace/root');
    });
  });
});
