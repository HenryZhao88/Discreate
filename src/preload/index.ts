// src/preload/index.ts
import { webFrame } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exposeNative } from "./native.js";

exposeNative();

// Inject the renderer bundle as soon as the document exists.
const rendererSrc = readFileSync(join(__dirname, "renderer.js"), "utf8");
webFrame.executeJavaScript(rendererSrc);

// Chain Discord's original preload so the client still works.
const original = process.env.DISCREATE_ORIGINAL_PRELOAD;
if (original) {
  try {
    require(original);
  } catch (err) {
    console.error("[Discreate] failed to load original preload:", err);
  }
}
