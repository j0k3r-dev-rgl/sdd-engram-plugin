/**
 * Minimal structured logger for the sdd-engram-plugin.
 *
 * - Four levels: info, warn, error, debug.
 * - All output goes to stderr via console.error to avoid polluting the TUI stdout.
 * - debug is silenced by default and activated by setting SDD_PLUGIN_DEBUG=1.
 * - Each line is prefixed with [sdd-plugin][<namespace>] for grep-ability.
 */

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

function isDebugEnabled(): boolean {
  return process.env.SDD_PLUGIN_DEBUG === "1";
}

export function createLogger(namespace: string): Logger {
  const prefix = `[sdd-plugin][${namespace}]`;

  const emit = (message: string, args: unknown[]): void => {
    if (args.length > 0) {
      console.error(`${prefix} ${message}`, ...args);
    } else {
      console.error(`${prefix} ${message}`);
    }
  };

  return {
    info(message, ...args) {
      emit(message, args);
    },
    warn(message, ...args) {
      emit(message, args);
    },
    error(message, ...args) {
      emit(message, args);
    },
    debug(message, ...args) {
      if (!isDebugEnabled()) return;
      emit(message, args);
    },
  };
}
