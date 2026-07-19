import { describe, expect, it } from "vitest";
import { importCandidates } from "../../src/renderer/core/themes";

describe("importCandidates", () => {
  it("prefers GitHub's raw host for GitHub Pages assets", () => {
    expect(importCandidates("https://refact0r.github.io/midnight-discord/build/midnight.css")).toEqual([
      "https://raw.githubusercontent.com/refact0r/midnight-discord/HEAD/build/midnight.css",
      "https://refact0r.github.io/midnight-discord/build/midnight.css",
    ]);
  });

  it("leaves non-GitHub imports unchanged", () => {
    expect(importCandidates("https://example.com/theme.css")).toEqual([
      "https://example.com/theme.css",
    ]);
  });
});
