// src/renderer/core/logger.ts
export function makeLogger(scope: string) {
  const tag = `%c[Discreate:${scope}]`;
  const style = "color:#5865F2;font-weight:bold";
  return {
    log: (...a: unknown[]) => console.log(tag, style, ...a),
    warn: (...a: unknown[]) => console.warn(tag, style, ...a),
    error: (...a: unknown[]) => console.error(tag, style, ...a),
  };
}
