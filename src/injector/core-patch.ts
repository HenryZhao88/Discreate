import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const MARKER = "discreate-patched";
const VANILLA = "module.exports = require('./core.asar');\n";

export function isCorePatched(coreDir: string): boolean {
  const idx = join(coreDir, "index.js");
  if (!existsSync(idx)) return false;
  return readFileSync(idx, "utf8").includes(MARKER);
}

/** Copy the built runtime bundles into runtimeDir. */
export function installRuntime(buildDir: string, runtimeDir: string): void {
  mkdirSync(runtimeDir, { recursive: true });
  for (const file of ["loader.js", "preload.js", "renderer.js"]) {
    copyFileSync(join(buildDir, file), join(runtimeDir, file));
  }
}

/** Patch discord_desktop_core/index.js to load Discreate before core.asar. */
export function patchCore(coreDir: string, runtimeDir: string): void {
  const idx = join(coreDir, "index.js");
  const backup = join(coreDir, "index.js.discreate-backup");
  // Back up the original one-liner once, never overwrite the backup with a patched file.
  if (!isCorePatched(coreDir) && !existsSync(backup)) {
    copyFileSync(idx, backup);
  }
  const loaderPath = join(runtimeDir, "loader.js");
  const content =
    `// ${MARKER}\n` +
    `require(${JSON.stringify(loaderPath)});\n` +
    `if (global.__discreateSelfHeal) global.__discreateSelfHeal(__dirname);\n` +
    `module.exports = require('./core.asar');\n`;
  writeFileSync(idx, content);
}

export function unpatchCore(coreDir: string): void {
  if (!isCorePatched(coreDir)) return;
  const idx = join(coreDir, "index.js");
  const backup = join(coreDir, "index.js.discreate-backup");
  if (existsSync(backup)) {
    copyFileSync(backup, idx);
    rmSync(backup);
  } else {
    writeFileSync(idx, VANILLA);
  }
}
