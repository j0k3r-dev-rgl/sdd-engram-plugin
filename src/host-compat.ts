import { createLogger } from "./logger";

const log = createLogger("host-compat");

const RENDERER_MISSING_MESSAGE = "No renderer found";

export interface HostApi {
  app?: { version?: string };
}

let rendererMissingReported = false;
const reportedSlotFailures = new Set<string>();

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

		reportSlotFailure(label, error);
		return null;
	}
}

function isRendererMissing(error: unknown): boolean {
	if (error instanceof Error) {
		return (
			error.message.includes(RENDERER_MISSING_MESSAGE) ||
			(error.cause ? isRendererMissing(error.cause) : false)
		);
	}
	return typeof error === "string" && error.includes(RENDERER_MISSING_MESSAGE);
}

function reportSlotFailure(label: string, error: unknown): void {
	if (reportedSlotFailures.has(label)) return;
	reportedSlotFailures.add(label);
	log.warn(
		`slot '${label}' disabled after render failure; OpenCode will continue without this optional UI.`,
		error,
	);
}

export function safeHostAction<T>(
	label: string,
	action: () => T,
	fallback: T,
): T {
	try {
		return action();
	} catch (error) {
		log.warn(`${label} failed; OpenCode will continue.`, error);
		return fallback;
	}
}

export async function safeHostAsyncAction<T>(
	label: string,
	action: () => Promise<T>,
	fallback: T,
): Promise<T> {
	try {
		return await action();
	} catch (error) {
		log.warn(`${label} failed; OpenCode will continue.`, error);
		return fallback;
	}
}

export function resetHostCompatStateForTests(): void {
	rendererMissingReported = false;
	reportedSlotFailures.clear();
}
