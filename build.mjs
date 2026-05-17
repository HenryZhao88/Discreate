// build.mjs
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist/build", { recursive: true });
mkdirSync("dist/injector", { recursive: true });

const shared = { bundle: true, platform: "node", target: "node20", logLevel: "info" };

// Main-process loader -> dist/build/loader.js
await build({
  ...shared,
  entryPoints: ["src/loader/index.ts"],
  outfile: "dist/build/loader.js",
  format: "cjs",
  external: ["electron"],
});

// Preload bridge -> dist/build/preload.js
await build({
  ...shared,
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/build/preload.js",
  format: "cjs",
  external: ["electron"],
});

// Renderer core -> dist/build/renderer.js (runs in Discord's web context)
await build({
  bundle: true,
  entryPoints: ["src/renderer/core/index.ts"],
  outfile: "dist/build/renderer.js",
  platform: "browser",
  target: "chrome120",
  format: "iife",
  jsxFactory: "Discreate.React.createElement",
  jsxFragment: "Discreate.React.Fragment",
  logLevel: "info",
});

// Injector CLI -> dist/injector/cli.js
await build({
  ...shared,
  entryPoints: ["src/injector/cli.ts"],
  outfile: "dist/injector/cli.js",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
});

console.log("Build complete.");
