import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { listProjectMemories, deleteProjectMemory } from './memories';
import { resolveProjectCandidates, resolveProjectName } from './config';

vi.mock('node:child_process');
vi.mock('./config');

describe('memories logic', () => {
  const mockApi = { state: { path: { directory: '/path/to/repo' } } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listProjectMemories', () => {
    it('should return empty list if no candidates', () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue([]);
      expect(listProjectMemories(mockApi)).toEqual([]);
    });

    it('should query sqlite and return normalized observations', () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(["my-repo", "O'Reilly"]);
      vi.mocked(resolveProjectName).mockReturnValue('repo');

      const mockObservations = [
        {
          id: 1,
          type: 'decision',
          title: 'A title',
          content: 'Some content',
          project: 'repo',
          scope: 'project',
          updated_at: '2023-01-01',
          created_at: '2023-01-01',
          topic_key: 'arch'
        }
      ];

      vi.mocked(execFileSync).mockReturnValue(JSON.stringify(mockObservations));

      const result = listProjectMemories(mockApi);
      expect(result.length).toBe(1);
      
      // Verify sqlite command
      const [cmd, args] = vi.mocked(execFileSync).mock.calls[0];
      expect(cmd).toBe('sqlite3');
      const query = (args as string[])[2];
      expect(query).toContain("'o''reilly'"); // escaped quote
    });

    it('should handle single object response from sqlite', () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
      vi.mocked(resolveProjectName).mockReturnValue('repo');
      
      const mockObservation = { id: 2, title: 'Single' };
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify(mockObservation));

      const result = listProjectMemories(mockApi);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(2);
      expect(result[0].title).toBe('Single');
    });

    it('should handle ndjson (line separated) response from sqlite', () => {
        vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
        vi.mocked(resolveProjectName).mockReturnValue('repo');
        
        const output = JSON.stringify({ id: 1, title: 'one' }) + '\n' + JSON.stringify({ id: 2, title: 'two' });
        vi.mocked(execFileSync).mockReturnValue(output);
  
        const result = listProjectMemories(mockApi);
        expect(result.length).toBe(2);
        expect(result[0].id).toBe(1);
        expect(result[1].id).toBe(2);
      });

    it('should handle sqlite failures gracefully', () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('sqlite crashed');
      });

      expect(listProjectMemories(mockApi)).toEqual([]);
    });

    it('should handle empty or whitespace output', () => {
        vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
        vi.mocked(execFileSync).mockReturnValue('  \n  ');
  
        expect(listProjectMemories(mockApi)).toEqual([]);
      });
  });

  describe('deleteProjectMemory', () => {
    it('should throw for invalid ID', () => {
      expect(() => deleteProjectMemory(0)).toThrow('Invalid Memory ID');
      expect(() => deleteProjectMemory(-1)).toThrow('Invalid Memory ID');
      expect(() => deleteProjectMemory('abc' as any)).toThrow('Invalid Memory ID');
    });

    it('should execute update query for valid ID', () => {
      deleteProjectMemory(42);
      
      const [cmd, args] = vi.mocked(execFileSync).mock.calls[0];
      expect(cmd).toBe('sqlite3');
      const query = (args as string[])[1];
      expect(query).toContain('UPDATE observations');
      expect(query).toContain('SET deleted_at = datetime(\'now\')');
      expect(query).toContain('WHERE id = 42');
    });
  });

  describe('normalization', () => {
    it('should fill defaults for missing fields', () => {
        vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
        vi.mocked(resolveProjectName).mockReturnValue('repo');
        
        // Single minimal object
        vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ id: "123" }));
  
        const result = listProjectMemories(mockApi);
        expect(result[0]).toEqual({
          id: 123,
          type: 'manual',
          title: '',
          topic_key: '',
          content: '',
          project: 'repo',
          scope: 'project',
          updated_at: '',
          created_at: '',
        });
    });

    it('should preserve existing values', () => {
        vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
        vi.mocked(resolveProjectName).mockReturnValue('repo');
        
        const full = {
          id: 7,
          type: 'bugfix',
          title: 'T',
          topic_key: 'K',
          content: 'C',
          project: 'P',
          scope: 'personal',
          updated_at: 'U',
          created_at: 'C2'
        };
        vi.mocked(execFileSync).mockReturnValue(JSON.stringify(full));
  
        const result = listProjectMemories(mockApi);
        expect(result[0]).toEqual({
            id: 7,
            type: 'bugfix',
            title: 'T',
            topic_key: 'K',
            content: 'C',
            project: 'P', // Preserved even if it differs from current projectName
            scope: 'personal',
            updated_at: 'U',
            created_at: 'C2'
        });
    });
  });
});
