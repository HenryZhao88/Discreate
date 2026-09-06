export const LATEST_COMMIT_URL =
  "https://api.github.com/repos/HenryZhao88/Discreate/commits/main";

export function parseInstalledCommit(json: string | null): string | null {
  if (!json) return null;
  try { const v = JSON.parse(json)?.commit; return typeof v === "string" ? v : null; }
  catch { return null; }
}

export function parseLatestCommit(apiBody: string): string | null {
  try { const v = JSON.parse(apiBody)?.sha; return typeof v === "string" ? v : null; }
  catch { return null; }
}

export interface UpdateStatus {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

export async function checkForUpdate(deps: {
  readInstalled: () => string | null;
  fetchText: (url: string) => Promise<string>;
}): Promise<UpdateStatus> {
  const installed = parseInstalledCommit(deps.readInstalled());
  try {
    const latest = parseLatestCommit(await deps.fetchText(LATEST_COMMIT_URL));
    return { installed, latest, updateAvailable: !!installed && !!latest && installed !== latest };
  } catch {
    return { installed, latest: null, updateAvailable: false };
  }
}
