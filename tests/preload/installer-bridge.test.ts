import { describe, it, expect, vi } from "vitest";
import { installerLaunchArgs } from "../../src/preload/native.js";

describe("installerLaunchArgs", () => {
  it("returns open args for the canonical installer path when it exists", () => {
    const args = installerLaunchArgs("/Users/x/.discreate", (p) => p.endsWith("install.command"));
    expect(args).toEqual(["/Users/x/.discreate/install.command"]);
  });
  it("throws when the installer file is absent", () => {
    expect(() => installerLaunchArgs("/Users/x/.discreate", () => false)).toThrow();
  });
});
