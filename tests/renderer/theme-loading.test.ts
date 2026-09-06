// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineImports, ThemeManager } from "../../src/renderer/core/themes";
import { SettingsStore } from "../../src/renderer/core/settings";

afterEach(() => { document.head.replaceChildren(); delete (window as any).DiscreateNative; });
describe("theme loading", () => {
  it("resolves nested relative imports/assets, media conditions, and literal replacement tokens", async () => {
    const files: Record<string, string> = {
      "https://theme.test/css/main.css": '@import "nested.css"; .image { background:url(../image.png) } .text:after { content:"$&" }',
      "https://theme.test/css/nested.css": ".nested { color:red }",
    };
    (window as any).DiscreateNative = { root: "/test", writeText() {}, fetchText: vi.fn((url: string) => Promise.resolve(files[url])) };
    const css = await inlineImports('@import url("https://theme.test/css/main.css") screen and (min-width: 800px);');
    expect(css).toContain("@media screen and (min-width: 800px)");
    expect(css).toContain(".nested { color:red }");
    expect(css).toContain('url("https://theme.test/image.png")');
    expect(css).toContain('content:"$&"');
    expect(css).not.toContain("@import");
  });

  it("does not let a stale remote load overwrite a newer hot reload; removes deleted CSS", async () => {
    let finish!: (value: string) => void;
    let raw: string | null = '@import url("https://race.test/style.css");';
    let changed!: () => void;
    (window as any).DiscreateNative = {
      root: "/test", themesDir: "/themes", readText: () => raw, writeText() {},
      fetchText: () => new Promise<string>((resolve) => { finish = resolve; }),
      watchDir: (_: string, cb: () => void) => { changed = cb; },
    };
    const settings = new SettingsStore({ read: () => null, write() {} });
    settings.setEnabledThemes(["test.css"]);
    new ThemeManager(settings).start();
    raw = ".new { color:blue }";
    changed();
    await Promise.resolve();
    finish(".old { color:red }");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vi.waitFor(() => expect(document.getElementById("discreate-theme-test.css")?.textContent).toBe(raw));
    raw = null;
    changed();
    expect(document.getElementById("discreate-theme-test.css")).toBeNull();
  });
});
