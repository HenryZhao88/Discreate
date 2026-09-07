// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderUpdatePrompt } from "../../src/renderer/ui/inject-settings.js";

describe("renderUpdatePrompt", () => {
  it("returns null when no update", () => {
    expect(renderUpdatePrompt({ installed: "a", latest: "a", updateAvailable: false }, () => {})).toBeNull();
  });

  it("renders a modal with Update Now and Later buttons", () => {
    const el = renderUpdatePrompt({ installed: "a", latest: "b", updateAvailable: true }, () => {})!;
    expect(el).not.toBeNull();
    expect(el.textContent).toMatch(/update available/i);
    const labels = [...el.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("Update Now");
    expect(labels).toContain("Later");
  });

  it("Update Now fires the callback and removes itself", () => {
    const onUpdate = vi.fn();
    const el = renderUpdatePrompt({ installed: "a", latest: "b", updateAvailable: true }, onUpdate)!;
    document.body.appendChild(el);
    const update = [...el.querySelectorAll("button")].find((b) => b.textContent === "Update Now")!;
    update.click();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(document.body.contains(el)).toBe(false);
  });

  it("Later dismisses without firing the callback", () => {
    const onUpdate = vi.fn();
    const el = renderUpdatePrompt({ installed: "a", latest: "b", updateAvailable: true }, onUpdate)!;
    document.body.appendChild(el);
    const later = [...el.querySelectorAll("button")].find((b) => b.textContent === "Later")!;
    later.click();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(document.body.contains(el)).toBe(false);
  });
});
