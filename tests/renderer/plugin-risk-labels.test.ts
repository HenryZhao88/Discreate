import { describe, it, expect } from "vitest";
import { RISKY_PLUGINS, describePlugin } from "../../src/renderer/ui/inject-settings.js";

describe("plugin risk labels", () => {
  it("flags the account-risk plugins", () => {
    expect(RISKY_PLUGINS.has("viewDeletedMessages")).toBe(true);
    expect(RISKY_PLUGINS.has("showHiddenChannels")).toBe(true);
  });
  it("appends a warning to risky plugin descriptions", () => {
    const d = describePlugin("viewDeletedMessages", "Logs deleted messages.");
    expect(d).toContain("Logs deleted messages.");
    expect(d).toMatch(/⚠|risk|account/i);
  });
  it("leaves non-risky descriptions unchanged", () => {
    expect(describePlugin("readAll", "Marks all read.")).toBe("Marks all read.");
  });
});
