// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoTranslate } from "../../src/renderer/plugins/autoTranslate/implementation";

function fixture() {
  const refresh = vi.fn();
  const api = { Data: { load: () => null, save: vi.fn() }, Logger: { error: vi.fn() } };
  const BdApi: any = function () { return api; };
  BdApi.React = { createElement: vi.fn() };
  BdApi.Components = { ErrorBoundary: () => null };
  const Plugin = createAutoTranslate(BdApi);
  const plugin: any = new Plugin({ name: "AutoTranslate" });
  Object.assign(plugin, {
    active: true, targetLang: "en", ChannelStore: { getChannel: () => ({ isPrivate: () => false, guild_id: "guild" }) },
    refresh, prepLang: vi.fn(), notify: vi.fn(),
  });
  return { plugin, api, refresh };
}
afterEach(() => vi.restoreAllMocks());

describe("AutoTranslate", () => {
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
