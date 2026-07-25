// src/renderer/core/paths.ts
// Access to the native bridge exposed by the preload.
export interface Native {
  root: string;
  themesDir: string;
  pluginsDir: string;
  readText(p: string): string | null;
  writeText(p: string, data: string): void;
  /** Append to a log file, truncating it once it exceeds `capBytes` (default 2 MB). */
  appendText(p: string, data: string, capBytes?: number): void;
  listDir(p: string): string[];
  readSettings(): string | null;
  writeSettings(data: string): void;
  readDeletedLog(): string | null;
  writeDeletedLog(data: string): void;
  watchDir(p: string, cb: () => void): void;
  reinject(): Promise<{ patched: string[] }>;
  deleteFile(p: string): void;
  openFolder(p: string): void;
  downloadToFolder(url: string, folder: string, filename?: string): Promise<string>;
  fetchText(url: string): Promise<string>;
}

export function native(): Native {
  return (window as any).DiscreateNative as Native;
}
