// Track compatibility proxies by identity without reading arbitrary properties.
const excludedModules = new WeakSet<object>();
export function excludeModuleFromSearch(mod: object): void { excludedModules.add(mod); }
export function isExcludedModule(mod: object): boolean { return excludedModules.has(mod); }
