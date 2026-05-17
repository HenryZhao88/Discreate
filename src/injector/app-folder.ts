// src/injector/app-folder.ts
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "discreate";

/** index.js placed in the app/ override: boots Discreate, then real Discord. */
const LOADER_STUB = `// Discreate ${MARKER}
require("./_discreate/index.js");
require("../app.asar");
`;

export function isInjected(resources: string): boolean {
  const pkgPath = join(resources, "app", "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).discreate === true;
  } catch {
    return false;
  }
}

export function injectFolder(resources: string, buildDir: string): void {
  const appDir = join(resources, "app");
  const modDir = join(appDir, "_discreate");
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(modDir, { recursive: true });
  writeFileSync(
    join(appDir, "package.json"),
    JSON.stringify({ name: "discord", main: "index.js", discreate: true }, null, 2),
  );
  writeFileSync(join(appDir, "index.js"), LOADER_STUB);
  for (const file of ["index.js", "preload.js", "renderer.js"]) {
    copyFileSync(join(buildDir, file), join(modDir, file));
  }
}

export function removeFolder(resources: string): void {
  rmSync(join(resources, "app"), { recursive: true, force: true });
}
