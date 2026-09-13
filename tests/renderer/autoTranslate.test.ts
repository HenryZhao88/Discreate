// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoTranslate } from "../../src/renderer/plugins/autoTranslate/implementation";
import { defaultLanguages, languageOptions } from "../../src/renderer/plugins/autoTranslate/languages";

function fixture() {
  const refresh = vi.fn();
  const api = { Data: { load: () => null, save: vi.fn() }, Logger: { error: vi.fn() } };
  const BdApi: any = function () { return api; };
  BdApi.React = { createElement: vi.fn(), cloneElement: (element: any, props: any) => ({ ...element, props: { ...element.props, ...props } }) };
  BdApi.ContextMenu = { patch: vi.fn(() => vi.fn()) };
  BdApi.Components = { ErrorBoundary: () => null };
  const Plugin = createAutoTranslate(BdApi);
  const plugin: any = new Plugin({ name: "AutoTranslate" });
  Object.assign(plugin, {
    active: true, targetLang: "en", ChannelStore: { getChannel: () => ({ isPrivate: () => false, guild_id: "guild" }) },
    refresh, prepLang: vi.fn(), notify: vi.fn(),
  });
  return { plugin, api, refresh, React: BdApi.React };
}
afterEach(() => vi.restoreAllMocks());

describe("AutoTranslate", () => {
  it("adds the original toggle to the native menu only for a current translation", () => {
    const { plugin, React } = fixture();
    React.createElement.mockImplementation((type: any, props: any) => ({ type, props }));
    const nativeItem = () => null;
    const copy = { type: nativeItem, props: { id: "copy-text", label: "Copy Text", action: vi.fn() } };
    const menu = { type: "menu", props: { navId: "message", children: [{ type: "group", props: { children: [copy] } }] } };
    const message = { id: "one", content: "bonjour" };
    expect(plugin.messageMenu(menu, { message })).toBe(menu);
    plugin.cache.set("one", { raw: "bonjour", text: "hello" });
    plugin.cache.set("two", { raw: "hola", text: "hello" });
    const patched = plugin.messageMenu(menu, { message });
    const items = patched.props.children[0].props.children;
    expect(items[0]).toBe(copy);
    expect(items[1].type).toBe(nativeItem);
    expect(items[1].props.label).toBe("Show original");
    items[1].props.action();
    expect(plugin.originals.has("one")).toBe(true);
    expect(plugin.originals.has("two")).toBe(false);
    expect(plugin.notify).toHaveBeenCalledWith("one");
    const restored = plugin.messageMenu(menu, { message }).props.children[0].props.children[1];
    expect(restored.props.label).toBe("Show translation");
    restored.props.action();
    expect(plugin.originals.has("one")).toBe(false);
    expect(plugin.messageMenu(menu, { message: { ...message, content: "edited" } })).toBe(menu);
    expect(menu.props.children[0].props.children).toEqual([copy]);
  });
  it("shows only the selected text and gives the translation a white source-language tag", () => {
    const { plugin, React } = fixture();
    React.createElement.mockImplementation((type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }));
    plugin.parser = { parse: (text: string) => text };
    const translation = { text: "hello", raw: "bonjour", src: "fr" };
    const rendered = plugin.render(translation);
    expect(rendered.props.children[0].props.children[0]).toBe("hello");
    expect(rendered.props.children[1]).toBe(false);
    expect(rendered.props.children[0].props.children[1].props.style.color).toBe("#fff");
    expect(rendered.props.children[0].props.children[1].props.children).toContain("translated · french");
    const original = plugin.render(translation, [], true);
    expect(original.props.children).toHaveLength(1);
    expect(original.props.children[0].props.children[0]).toBe("bonjour");
  });
  it("makes the full language catalog available without a request or a restrictive default filter", () => {
    const { plugin } = fixture();
    expect(Object.keys(plugin.langNames).length).toBeGreaterThan(200);
    expect(plugin.langNames["zh-CN"]).toBe("Chinese (Simplified)");
    expect(plugin.langNames["zh-TW"]).toBe("Chinese (Traditional)");
    expect(plugin.langNames.yue).toBe("Cantonese");
    expect(plugin.blocked("fr")).toBe(false);
    expect(plugin.blocked("ja")).toBe(false);
    plugin.reset();
    expect(plugin.langNames).toEqual(defaultLanguages);
  });
  it("persists favorites and sorts them first without hiding other languages", () => {
    const { plugin, api } = fixture();
    plugin.setFavorites(["ja", "fr", "ja", "unknown"]);
    expect(api.Data.save).toHaveBeenLastCalledWith("settings", expect.objectContaining({ favorites: ["ja", "fr"] }));
    const options = languageOptions(plugin.langNames, plugin.settings.favorites);
    expect(new Set(options.slice(0, 2).map((o) => o.value))).toEqual(new Set(["ja", "fr"]));
    expect(options).toHaveLength(Object.keys(defaultLanguages).length);
    expect(options[0].label).toMatch(/^★ /);
  });
  it("previews text with explicit input/output languages while preserving formatting and protected words", async () => {
    const { plugin } = fixture();
    plugin.translate = vi.fn(async (texts: string[]) => ({ results: [{ text: texts[0].replace("hello", "bonjour"), src: "auto" }] }));
    plugin.setProtectedPrefixes("!, /, !");
    const raw = "hello !command /dance <@123> https://example.test `code`";
    expect(await plugin.preview(raw, "en", "fr")).toEqual({ text: raw.replace("hello", "bonjour"), src: "en", target: "fr" });
    expect(plugin.translate.mock.calls[0].slice(1)).toEqual(["fr", "en"]);
    expect(plugin.translate.mock.calls[0][0][0]).not.toContain("!command");
    expect(plugin.cache.size).toBe(0);
  });
  it("reports preview failures and discards a response after settings change", async () => {
    const { plugin } = fixture();
    plugin.translate = async () => ({ rateLimited: true });
    await expect(plugin.preview("hello", "auto", "fr")).rejects.toThrow("rate limiting");
    let resolve!: (result: any) => void;
    plugin.translate = () => new Promise((r) => { resolve = r; });
    const preview = plugin.preview("hello", "en", "fr");
    plugin.reset();
    resolve({ results: [{ text: "bonjour", src: "en" }] });
    await expect(preview).rejects.toThrow("Settings changed");
  });
  it("retains the bundled languages when the catalog request fails", async () => {
    const { plugin } = fixture();
    plugin.translate = async () => ({ results: [{ text: "translated" }] });
    plugin.req = vi.fn().mockRejectedValue(new Error("offline"));
    await plugin.constructor.prototype.prepLang.call(plugin);
    expect(plugin.langNames).toEqual(defaultLanguages);
    expect(plugin.req).toHaveBeenCalledOnce();
    await plugin.constructor.prototype.prepLang.call(plugin);
    expect(plugin.req).toHaveBeenCalledOnce();
  });
  it("renders both texts when requested and refreshes mounted messages", () => {
    const { plugin, React, refresh } = fixture();
    React.createElement.mockImplementation((type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }));
    plugin.parser = { parse: (text: string) => text };
    plugin.setShowOriginal(true);
    const rendered = plugin.render({ text: "hello", raw: "bonjour", src: "fr" });
    expect(rendered.props).toHaveProperty("data-show-original");
    expect(rendered.props.children[0].props.children[0]).toBe("hello");
    expect(rendered.props.children[1].props.children[0]).toBe("bonjour");
    expect(refresh).toHaveBeenCalled();
  });
  it("uses live user identity and leaves messages alone until login finishes", () => {
    const { plugin } = fixture();
    let currentId: string | undefined;
    let patch!: (ctx: any, args: any[], ret: any) => void;
    plugin.UserStore = { getCurrentUser: () => currentId ? { id: currentId } : undefined };
    plugin.modules = { MessageContent: {}, Parser: {} };
    plugin.api.Patcher = { after: (_module: any, _key: string, callback: any) => { patch = callback; } };
    plugin.patch();
    const message = { id: "1", author: { id: "author" }, content: "bonjour" };
    const render = () => {
      const ret = { props: { children: [["bonjour"]] } };
      patch(null, [{ message }], ret);
      return ret;
    };
    expect(render().props.children).toEqual([["bonjour"]]);
    currentId = "author";
    expect(render().props.children).toEqual([["bonjour"]]);
    currentId = "viewer";
    expect(render().props.children).toEqual([undefined]);
  });
  it("deduplicates batch requests and restores mentions, links, and code", async () => {
    const { plugin } = fixture();
    const raw = "bonjour <@123> https://example.test `code`";
    plugin.translate = vi.fn(async (texts: string[]) => ({ results: texts.map((text) => ({ text: text.replace("bonjour", "hello"), src: "fr" })) }));
    const batch = ["1", "2"].map((msgId) => ({ msgId, raw, stripped: "bonjour", channel_id: "channel" }));
    batch.forEach((item) => plugin.pending.add(item.msgId));
    await plugin.runBatch(batch);
    expect(plugin.translate.mock.calls[0][0]).toHaveLength(1);
    expect(plugin.cache.get("1").text).toBe("hello <@123> https://example.test `code`");
    expect(plugin.cache.get("2").text).toBe(plugin.cache.get("1").text);
    expect(plugin.pending.size).toBe(0);
  });
  it("rejects stale responses after resetting even if the target language is unchanged", async () => {
    const { plugin } = fixture();
    let resolve!: (result: any) => void;
    plugin.translate = () => new Promise((r) => { resolve = r; });
    const run = plugin.runBatch([{ msgId: "1", raw: "bonjour", stripped: "bonjour", channel_id: "channel" }]);
    plugin.reset();
    resolve({ results: [{ text: "hello", src: "fr" }] });
    await run;
    expect(plugin.cache.size).toBe(0);
    expect(plugin.notify).not.toHaveBeenCalled();
  });
  it("keeps DMs off and refreshes mounted messages when filters change", () => {
    const { plugin, refresh } = fixture();
    expect(plugin.allowed({ isPrivate: () => true })).toBe(false);
    plugin.setDms(true);
    expect(plugin.allowed({ isPrivate: () => true })).toBe(true);
    expect(refresh).toHaveBeenCalled();
    plugin.cache.set("1", { raw: "bonjour", stripped: "bonjour", src: "fr", channel_id: "channel" });
    plugin.setSkipLangs(["fr"]);
    expect(plugin.cache.has("1")).toBe(false);
    expect(plugin.skipped.get("1").src).toBe("fr");
  });
  it("requeues rate-limited messages without losing pending state", async () => {
    const { plugin } = fixture();
    plugin.translate = async () => ({ rateLimited: true, retryAfter: 15 });
    plugin.tripPause = vi.fn();
    plugin.pending.add("1");
    const item = { msgId: "1", raw: "bonjour", stripped: "bonjour", channel_id: "channel" };
    await plugin.runBatch([item]);
    expect(plugin.tripPause).toHaveBeenCalledWith(15);
    expect(plugin.queue).toEqual([item]);
    expect(plugin.pending.has("1")).toBe(true);
  });
});
