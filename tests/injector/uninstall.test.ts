import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { findAllCoreDirs } from "../../src/injector/discord-paths";
import { patchCore, unpatchCore, isCorePatched } from "../../src/injector/core-patch";
import { launcherScript } from "../../src/injector/launcher";

describe("uninstall and launcher", () => {
  it("finds and restores every version and module revision", () => {
    const base = mkdtempSync(join(tmpdir(), "discreate-uninstall-"));
    try {
      const cores = [
        join(base, "0.0.1", "modules", "discord_desktop_core"),
        join(base, "app-0.0.2", "modules", "discord_desktop_core-1", "discord_desktop_core"),
        join(base, "app-0.0.2", "modules", "discord_desktop_core-2", "discord_desktop_core"),
      ];
      for (const core of cores) {
        mkdirSync(core, { recursive: true });
        writeFileSync(join(core, "index.js"), "// original");
        writeFileSync(join(core, "core.asar"), "fixture");
        patchCore(core, base);
      }
      expect(findAllCoreDirs(base).sort()).toEqual(cores.sort());
      for (const core of findAllCoreDirs(base)) unpatchCore(core);
      expect(cores.some(isCorePatched)).toBe(false);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  it("passes special characters literally and stops after failed injection", () => {
    const tricky = "/tmp/space ' quote $(printf SUBSTITUTED) `printf BACKTICK`/cli.js";
    const script = launcherScript("/usr/bin/printf", tricky);
    // Exit at the launch step, without opening any application.
    const output = spawnSync("bash", ["-c", 'open() { return 1; }; ' + script + '\n'], { encoding: "utf8" });
    expect(output.stdout).toContain(tricky);
    expect(output.status).toBe(1);
    const failed = spawnSync("bash", ["-c", 'open() { printf UNEXPECTED_LAUNCH; }; ' + launcherScript("/usr/bin/false", tricky)], { encoding: "utf8" });
    expect(failed.status).toBe(1);
    expect(failed.stdout).not.toContain("UNEXPECTED_LAUNCH");
  });
});
