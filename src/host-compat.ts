import { createLogger } from "./logger";

const log = createLogger("host-compat");

const RENDERER_MISSING_MESSAGE = "No renderer found";

export interface HostApi {
  app?: { version?: string };
}

let rendererMissingReported = false;

export function getHostVersion(api: HostApi): string {
  return api?.app?.version ?? "unknown";
}

export function safeSlotRender<T>(label: string, render: () => T): T | null {
  try {
    return render();
  } catch (error) {
    if (isRendererMissing(error)) {
      if (!rendererMissingReported) {
        rendererMissingReported = true;
        log.warn(
          `slot '${label}' disabled: host TUI did not expose a Solid renderer. ` +
            "Pin opencode to a compatible version or upgrade opencode-sdd-engram-manage.",
        );
      }
      return null;
    }
    throw error;
  }
}

function isRendererMissing(error: unknown): boolean {
  return error instanceof Error && error.message === RENDERER_MISSING_MESSAGE;
}

export function resetHostCompatStateForTests(): void {
  rendererMissingReported = false;
}
