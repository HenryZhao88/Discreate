import { byProps, findAll } from "./webpack.js";

/** Proxy placeholders synthesize every property and stringify as native code. */
function ownsImplementation(module: any, name: string): boolean {
  try {
    return byProps(name)(module) && Object.hasOwn(module, name) &&
      typeof module[name] === "function" &&
      !Function.prototype.toString.call(module[name]).includes("[native code]");
  } catch { return false; }
}

/** Resolve exports from the authoritative webpack runtime, preserving their identity. */
export function resolveReactDOM(reactVersion?: string): any {
  const clients = findAll((module) => ownsImplementation(module, "createRoot"));
  const compatible = clients.filter((module) => typeof module.version !== "string" || !reactVersion || module.version === reactVersion);
  const matchingVersion = compatible.filter((module) => module.version === reactVersion && typeof module.version === "string");
  if (matchingVersion.length === 1) return matchingVersion[0];
  if (compatible.length === 1) return compatible[0];
  // Multiple unvalidated renderers must not silently shadow the live provider.
  if (compatible.length > 1) throw new Error("Multiple ReactDOM clients in the active runtime");
  const legacy = findAll((module) => ownsImplementation(module, "render") && ownsImplementation(module, "unmountComponentAtNode"))
    .filter((module) => typeof module.version !== "string" || !reactVersion || module.version === reactVersion);
  if (legacy.length === 1) return legacy[0];
  if (legacy.length > 1) throw new Error("Multiple legacy ReactDOM renderers in the active runtime");
  return undefined;
}
