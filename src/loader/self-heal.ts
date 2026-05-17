import { readdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";

const MARKER = "discreate-patched";

/**
 * Given any patched discord_desktop_core dir, find sibling version dirs that
 * still hold a vanilla `index.js` and patch them with the same loader path.
 *
 * Layout: <appSupport>/<version>/modules/discord_desktop_core/index.js
 */
export function selfHealSiblings(currentCoreDir: string, loaderPath: string): string[] {
  const modulesDir = dirname(currentCoreDir); // .../<version>/modules
  const versionDir = dirname(modulesDir);     // .../<version>
  const appSupport = dirname(versionDir);     // .../<branch>
  if (!existsSync(appSupport)) return [];

  const patched: string[] = [];
  for (const entry of readdirSync(appSupport)) {
    if (!/^\d+\.\d+\.\d+$/.test(entry)) continue;
    const sibling = join(appSupport, entry, "modules", "discord_desktop_core");
    const idx = join(sibling, "index.js");
    if (!existsSync(idx) || !existsSync(join(sibling, "core.asar"))) continue;
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
