import { readdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { resolveCoreUnderModules } from "../injector/discord-paths.js";

const MARKER = "discreate-patched";

/**
 * Given any patched discord_desktop_core dir, find sibling version dirs that
 * still hold a vanilla `index.js` and patch them with the same loader path.
 *
 * Two layouts are supported:
 * - Legacy: `<appSupport>/<version>/modules/discord_desktop_core/`
 * - Current (2024+): `<appSupport>/app-<version>/modules/discord_desktop_core-<n>/discord_desktop_core/`
 */
export function selfHealSiblings(currentCoreDir: string, loaderPath: string): string[] {
  // The version dir is named `<v>` (legacy) or `app-<v>` (current). The
  // current layout adds one extra level under modules, so we can't assume a
  // fixed depth — walk up until we find the version dir.
  let appSupport: string | null = null;
  let cursor = dirname(currentCoreDir);
  for (let i = 0; i < 6 && cursor && cursor !== dirname(cursor); i++) {
    if (/^(?:app-)?\d+\.\d+\.\d+$/.test(basename(cursor))) {
      appSupport = dirname(cursor);
      break;
    }
    cursor = dirname(cursor);
  }
  if (!appSupport || !existsSync(appSupport)) return [];

  const patched: string[] = [];
  for (const entry of readdirSync(appSupport)) {
    if (!/^(?:app-)?\d+\.\d+\.\d+$/.test(entry)) continue;
    const sibling = resolveCoreUnderModules(join(appSupport, entry, "modules"));
    if (!sibling || sibling === currentCoreDir) continue;
    const idx = join(sibling, "index.js");
    if (!existsSync(idx)) continue;
    const current = readFileSync(idx, "utf8");
    if (current.includes(MARKER)) continue;
    const backup = join(sibling, "index.js.discreate-backup");
    if (!existsSync(backup)) copyFileSync(idx, backup);
    writeFileSync(
      idx,
      `// ${MARKER}\n` +
        `require(${JSON.stringify(loaderPath)});\n` +
        `if (global.__discreateSelfHeal) global.__discreateSelfHeal(__dirname);\n` +
        `module.exports = require('./core.asar');\n`,
    );
    patched.push(sibling);
  }
  return patched;
}
