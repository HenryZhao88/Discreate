// src/renderer/api/index.ts
// The surface plugins import. Populated at boot by the renderer entrypoint.
import * as webpack from "../core/webpack.js";
import { before, after, instead, unpatchAll } from "../core/patcher.js";
import { makeLogger } from "../core/logger.js";

export interface PluginContext {
  id: string;
  options: Record<string, unknown>;
  saveOptions(options: Record<string, unknown>): void;
}

export interface DiscreatePlugin {
  name: string;
  description: string;
  authors?: string[];
  /** Called when the plugin is enabled. */
  start(ctx: PluginContext): void;
  /** Called when the plugin is disabled; revert all changes here. */
  stop(ctx: PluginContext): void;
}

export interface DiscreateGlobal {
  React: any;
  ReactDOM: any;
  FluxDispatcher: any;
  webpack: typeof webpack;
  patcher: { before: typeof before; after: typeof after; instead: typeof instead };
  makeLogger: typeof makeLogger;
}

// Populated by renderer/core/index.ts before plugins start.
export const Discreate: Partial<DiscreateGlobal> = {
  webpack,
  patcher: { before, after, instead },
  makeLogger,
};

export { unpatchAll };
