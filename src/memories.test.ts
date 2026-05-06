import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listProjectMemories, deleteProjectMemory } from './memories';
import { resolveProjectCandidates, resolveProjectName } from './config';

vi.mock('./config');

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('memories logic', () => {
  const mockApi = { state: { path: { directory: '/path/to/repo' } } };

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockReset();
  });

  describe('listProjectMemories', () => {
    it('should return empty list if no candidates', async () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue([]);
      expect(await listProjectMemories(mockApi)).toEqual([]);
    });

    it('should query engram API and return normalized observations', async () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(["my-repo"]);
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockObservations
      });

      const result = await listProjectMemories(mockApi);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(1);
      
      // Verify fetch call
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/observations/recent?project=my-repo'),
        expect.anything()
      );
    });

    it('should query all candidates and merge results', async () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(['repo1', 'repo2']);
      vi.mocked(resolveProjectName).mockReturnValue('repo1');
      
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 1, title: 'one', updated_at: '2023-01-02' }]
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 2, title: 'two', updated_at: '2023-01-01' }]
        });

      const result = await listProjectMemories(mockApi);
      expect(result.length).toBe(2);
      expect(result[0].id).toBe(1); // latest first
      expect(result[1].id).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate memories by ID', async () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(['repo1', 'repo2']);
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [{ id: 1, title: 'same' }]
      });

      const result = await listProjectMemories(mockApi);
      expect(result.length).toBe(1);
    });

    it('should handle API failures gracefully', async () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
      mockFetch.mockRejectedValue(new Error('network error'));

      expect(await listProjectMemories(mockApi)).toEqual([]);
    });

    it('should log candidate fetch failures before returning empty list', async () => {
      vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValue(new Error('network error'));

      expect(await listProjectMemories(mockApi)).toEqual([]);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("[sdd-plugin][memories] listProjectMemories: failed to fetch recent observations for candidate 'repo'"),
        expect.any(Error)
      );
      stderrSpy.mockRestore();
    });
  });

  describe('deleteProjectMemory', () => {
    it('should throw for invalid ID', async () => {
      await expect(deleteProjectMemory(0)).rejects.toThrow('Invalid Memory ID');
      await expect(deleteProjectMemory(-1)).rejects.toThrow('Invalid Memory ID');
      await expect(deleteProjectMemory('abc' as any)).rejects.toThrow('Invalid Memory ID');
    });

    it('should call DELETE on engram API for valid ID', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      
      await deleteProjectMemory(42);
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/observations/42'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should throw if API returns not ok', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Error' });
        await expect(deleteProjectMemory(42)).rejects.toThrow('Engram API delete returned 500');
    });
  });

  describe('normalization', () => {
    it('should fill defaults for missing fields', async () => {
        vi.mocked(resolveProjectCandidates).mockReturnValue(['repo']);
        vi.mocked(resolveProjectName).mockReturnValue('repo');
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: "123" }]
        });
  
        const result = await listProjectMemories(mockApi);
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
  });
});
