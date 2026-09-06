function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function launcherScript(nodeBin: string, cliPath: string): string {
  return `#!/bin/bash
set -e
# Discreate launcher — double-click to re-inject and launch Discord.
cd "$(dirname "$0")"
echo "Reinjecting Discreate…"
${shellQuote(nodeBin)} ${shellQuote(cliPath)} inject
echo "Launching Discord…"
open -a /Applications/Discord.app
echo "Done."
sleep 1
`;
}
