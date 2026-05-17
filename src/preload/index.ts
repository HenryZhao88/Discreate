// src/preload/index.ts
import { webFrame } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exposeNative } from "./native.js";

// Registered as an additional session preload by the loader. Discord's own
// preload still runs independently, so there is nothing to chain here.
exposeNative();

// Inject the renderer bundle into the page's main world, where Discord's
// webpack lives.
const rendererSrc = readFileSync(join(__dirname, "renderer.js"), "utf8");
webFrame.executeJavaScript(rendererSrc);
