// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderUpdateBanner } from "../../src/renderer/ui/inject-settings.js";

describe("renderUpdateBanner", () => {
  it("returns null when no update", () => {
    expect(renderUpdateBanner({ installed: "a", latest: "a", updateAvailable: false }, () => {})).toBeNull();
  });
  it("renders a banner with an Update button that fires the callback", () => {
    const onUpdate = vi.fn();
    const el = renderUpdateBanner({ installed: "a", latest: "b", updateAvailable: true }, onUpdate)!;
    expect(el).not.toBeNull();
    expect(el.textContent).toMatch(/update/i);
    const btn = el.querySelector("button")!;
    btn.click();
    expect(onUpdate).toHaveBeenCalledOnce();
  });
});
