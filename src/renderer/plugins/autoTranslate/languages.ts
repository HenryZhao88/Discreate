import catalog from "./languages.json";

// Snapshot of Google's own target-language catalog, retrieved 2026-09-13:
// https://translate.googleapis.com/translate_a/l?client=gtx&hl=en
export const defaultLanguages: Record<string, string> = catalog;

export function languageOptions(names: Record<string, string>, favorites: string[], locale = "en") {
  const preferred = new Set(favorites);
  return Object.entries(names)
    .filter(([code, name]) => code !== "auto" && typeof name === "string")
    .map(([value, name]) => ({ value, label: preferred.has(value) ? `★ ${name}` : name }))
    .sort((a, b) => Number(preferred.has(b.value)) - Number(preferred.has(a.value)) ||
      a.label.localeCompare(b.label, locale));
}
