import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHostVersion,
  resetHostCompatStateForTests,
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

    it("warns once across multiple incompatible renders", () => {
      safeSlotRender("home_bottom", () => {
        throw new Error("No renderer found");
      });
      safeSlotRender("sidebar_content", () => {
        throw new Error("No renderer found");
      });
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("rethrows errors unrelated to the renderer", () => {
      expect(() =>
        safeSlotRender("home_bottom", () => {
          throw new Error("something else");
        }),
      ).toThrow("something else");
    });

    it("rethrows non-Error throwables", () => {
      expect(() =>
        safeSlotRender("home_bottom", () => {
          throw "string error";
        }),
      ).toThrow("string error");
    });
  });
});
