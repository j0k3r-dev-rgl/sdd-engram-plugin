import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from './logger';

describe('logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalDebug = process.env.SDD_PLUGIN_DEBUG;

  beforeEach(() => {
    vi.resetAllMocks();
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.SDD_PLUGIN_DEBUG;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalDebug === undefined) {
      delete process.env.SDD_PLUGIN_DEBUG;
    } else {
      process.env.SDD_PLUGIN_DEBUG = originalDebug;
    }
  });

  describe('createLogger', () => {
    it('returns an object with info, warn, error, debug methods', () => {
      const log = createLogger('config');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.debug).toBe('function');
    });
  });

  describe('output format and routing', () => {
    it('prefixes info with [sdd-plugin][<namespace>] and writes to stderr', () => {
      const log = createLogger('profiles');
      log.info('something happened');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy).toHaveBeenCalledWith(
        '[sdd-plugin][profiles] something happened'
      );
    });

    it('prefixes warn with [sdd-plugin][<namespace>] and writes to stderr', () => {
      const log = createLogger('config');
      log.warn('mkdir failed');
      expect(stderrSpy).toHaveBeenCalledWith(
        '[sdd-plugin][config] mkdir failed'
      );
    });

    it('prefixes error with [sdd-plugin][<namespace>] and writes to stderr', () => {
      const log = createLogger('memories');
      log.error('engram unreachable');
      expect(stderrSpy).toHaveBeenCalledWith(
        '[sdd-plugin][memories] engram unreachable'
      );
    });

    it('forwards extra args after the message', () => {
      const log = createLogger('profiles');
      const err = new Error('boom');
      log.warn('readProfile failed', err);
      expect(stderrSpy).toHaveBeenCalledWith(
        '[sdd-plugin][profiles] readProfile failed',
        err
      );
    });
  });

  describe('debug gating via SDD_PLUGIN_DEBUG', () => {
    it('does NOT emit debug by default', () => {
      const log = createLogger('profiles');
      log.debug('verbose detail');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('emits debug when SDD_PLUGIN_DEBUG=1', () => {
      process.env.SDD_PLUGIN_DEBUG = '1';
      const log = createLogger('profiles');
      log.debug('verbose detail');
      expect(stderrSpy).toHaveBeenCalledWith(
        '[sdd-plugin][profiles] verbose detail'
      );
    });

    it('does NOT emit debug when SDD_PLUGIN_DEBUG is set to other values', () => {
      process.env.SDD_PLUGIN_DEBUG = 'true';
      const log = createLogger('profiles');
      log.debug('verbose detail');
      expect(stderrSpy).not.toHaveBeenCalled();

      process.env.SDD_PLUGIN_DEBUG = '0';
      log.debug('still off');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('reads env dynamically per call (toggle at runtime)', () => {
      const log = createLogger('profiles');

      log.debug('off');
      expect(stderrSpy).not.toHaveBeenCalled();

      process.env.SDD_PLUGIN_DEBUG = '1';
      log.debug('on');
      expect(stderrSpy).toHaveBeenCalledTimes(1);

      delete process.env.SDD_PLUGIN_DEBUG;
      log.debug('off again');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('namespace isolation', () => {
    it('uses the namespace from createLogger, not a global one', () => {
      const a = createLogger('config');
      const b = createLogger('profiles');
      a.warn('A');
      b.warn('B');
      expect(stderrSpy).toHaveBeenNthCalledWith(1, '[sdd-plugin][config] A');
      expect(stderrSpy).toHaveBeenNthCalledWith(2, '[sdd-plugin][profiles] B');
    });
  });
});
