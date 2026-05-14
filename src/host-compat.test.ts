import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getHostVersion,
	resetHostCompatStateForTests,
	safeHostAction,
	safeHostAsyncAction,
	safeSlotRender,
} from "./host-compat";

describe("host-compat", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetHostCompatStateForTests();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("getHostVersion", () => {
    it("returns the version from api.app.version", () => {
      expect(getHostVersion({ app: { version: "1.14.49" } })).toBe("1.14.49");
    });

    it("returns 'unknown' when app is missing", () => {
      expect(getHostVersion({})).toBe("unknown");
    });

    it("returns 'unknown' when version is missing", () => {
      expect(getHostVersion({ app: {} })).toBe("unknown");
    });
  });

  describe("safeSlotRender", () => {
    it("returns the render result when nothing throws", () => {
      const result = safeSlotRender("home_bottom", () => "ok");
      expect(result).toBe("ok");
    });

	it("returns null when the renderer is missing", () => {
		const result = safeSlotRender("home_bottom", () => {
			throw new Error("No renderer found");
		});
		expect(result).toBeNull();
	});

	it("returns null when the renderer missing error is wrapped", () => {
		const result = safeSlotRender("home_bottom", () => {
			throw new Error("slot failed", { cause: new Error("No renderer found") });
		});
		expect(result).toBeNull();
	});

    it("warns once across multiple incompatible renders", () => {
      safeSlotRender("home_bottom", () => {
        throw new Error("No renderer found");
      });
      safeSlotRender("sidebar_content", () => {
        throw new Error("No renderer found");
      });
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

	it("disables the slot on errors unrelated to the renderer", () => {
		const result = safeSlotRender("home_bottom", () => {
			throw new Error("something else");
		});

		expect(result).toBeNull();
		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain(
			"OpenCode will continue without this optional UI",
		);
	});

	it("disables the slot on non-Error throwables", () => {
		const result = safeSlotRender("home_bottom", () => {
			throw "string error";
		});

		expect(result).toBeNull();
	});

	it("warns once per slot for non-renderer failures", () => {
		safeSlotRender("home_bottom", () => {
			throw new Error("first failure");
		});
		safeSlotRender("home_bottom", () => {
			throw new Error("second failure");
		});
		safeSlotRender("sidebar_content", () => {
			throw new Error("third failure");
		});

		expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
	});
});

describe("safeHostAction", () => {
	it("returns the action result when nothing throws", () => {
		expect(safeHostAction("register command", () => "ok", "fallback")).toBe(
			"ok",
		);
	});

	it("returns the fallback when the action throws", () => {
		const result = safeHostAction("register command", () => {
			throw new Error("boom");
		}, "fallback");

		expect(result).toBe("fallback");
		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain("OpenCode will continue");
	});
});

describe("safeHostAsyncAction", () => {
	it("returns the async action result when nothing throws", async () => {
		await expect(
			safeHostAsyncAction("load preferences", async () => "ok", "fallback"),
		).resolves.toBe("ok");
	});

	it("returns the fallback when the async action rejects", async () => {
		const result = await safeHostAsyncAction("load preferences", async () => {
			throw new Error("boom");
		}, "fallback");

		expect(result).toBe("fallback");
		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain("OpenCode will continue");
	});
});
});
