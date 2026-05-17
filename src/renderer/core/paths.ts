// src/renderer/core/paths.ts
// Access to the native bridge exposed by the preload.
export interface Native {
  root: string;
  themesDir: string;
  pluginsDir: string;
  readText(p: string): string | null;
  writeText(p: string, data: string): void;
  listDir(p: string): string[];
  readSettings(): string | null;
  writeSettings(data: string): void;
  readDeletedLog(): string | null;
  writeDeletedLog(data: string): void;
  watchDir(p: string, cb: () => void): void;
}

export function native(): Native {
  return (window as any).DiscreateNative as Native;
}
