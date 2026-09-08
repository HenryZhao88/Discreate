import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const installer = readFileSync(new URL("../../install.command", import.meta.url), "utf8");
const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

function runInstaller(injectFails: boolean) {
  const fixture = mkdtempSync(join(tmpdir(), "discreate-installer-"));
  const root = join(fixture, "data");
  const bin = join(fixture, "bin");
  const source = join(fixture, "source");
  for (const dir of [root, bin, source]) mkdirSync(dir);
  const latestInstaller = "#!/bin/bash\n# installer from the downloaded commit\nexit 0\n";
  const executable = (name: string, body: string) => writeFileSync(join(bin, name), body, { mode: 0o755 });
  // Execute the whole installer with a temporary data directory and local
  // command fixtures. No real Discord process, download, or injection is used.
  const script = installer.replace('ROOT="$HOME/.discreate"', `ROOT=${quote(root)}`)
    .replace('process.env.HOME+"/.discreate/installed.json"', JSON.stringify(join(root, "installed.json")));
  writeFileSync(join(root, "install.command"), script, { mode: 0o755 });
  writeFileSync(join(root, "installed.json"), '{"commit":"previous"}');
  writeFileSync(join(root, "settings.json"), "preserve settings");
  writeFileSync(join(source, "install.command"), latestInstaller, { mode: 0o755 });
  writeFileSync(join(source, "package.json"), JSON.stringify({ type: "module", version: "0.2.0", devDependencies: { esbuild: "^0.24.0" } }));
  writeFileSync(join(source, "build.mjs"), `
    import { mkdirSync, writeFileSync } from "node:fs";
    mkdirSync("dist/injector", { recursive: true });
    writeFileSync("dist/injector/cli.js", "process.exit(${injectFails ? 1 : 0});");
  `);
  const archive = join(fixture, "source.tar.gz");
  const tar = spawnSync("tar", ["-czf", archive, "-C", fixture, "source"]);
  if (tar.status !== 0) throw new Error(tar.stderr.toString());
  executable("node", `#!${process.execPath}
    const args = process.argv.slice(2);
    if (args[0] === "-e" && args[1].includes('https.get("https://api.github.com/')) {
      process.stdout.write("${"a".repeat(40)}");
    } else {
      const result = require("node:child_process").spawnSync(${JSON.stringify(process.execPath)}, args, { stdio: "inherit" });
      process.exit(result.status ?? 1);
    }
  `);
  executable("npm", "#!/bin/bash\nexit 0\n");
  executable("pgrep", "#!/bin/bash\nexit 1\n");
  for (const command of ["pkill", "open"]) executable(command, "#!/bin/bash\nexit 99\n");
  executable("curl", `#!/bin/bash
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "-o" ]; then cp ${quote(archive)} "$2"; exit; fi
      shift
    done
    exit 1
  `);
  try {
    const result = spawnSync("bash", [join(root, "install.command")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8", timeout: 10000,
    });
    return {
      status: result.status, output: result.stdout + result.stderr,
      savedInstaller: readFileSync(join(root, "install.command"), "utf8"),
      executable: !!(statSync(join(root, "install.command")).mode & 0o111),
      installed: JSON.parse(readFileSync(join(root, "installed.json"), "utf8")),
      settings: readFileSync(join(root, "settings.json"), "utf8"),
      latestInstaller, originalInstaller: script,
    };
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}

describe("installer update integration", () => {
  it("refreshes the stable installer from the successfully installed commit", () => {
    const result = runInstaller(false);
    expect(result.status, result.output).toBe(0);
    expect(result.savedInstaller).toBe(result.latestInstaller);
    expect(result.executable).toBe(true);
    expect(result.installed.commit).toBe("a".repeat(40));
    expect(result.settings).toBe("preserve settings");
  });
  it("retains the previous installer and baseline if injection fails", () => {
    const result = runInstaller(true);
    expect(result.status, result.output).not.toBe(0);
    expect(result.savedInstaller).toBe(result.originalInstaller);
    expect(result.installed.commit).toBe("previous");
    expect(result.settings).toBe("preserve settings");
  });
});
