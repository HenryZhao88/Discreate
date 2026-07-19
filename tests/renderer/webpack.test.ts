import { describe, it, expect } from "vitest";
import {
  byProps,
  byCode,
  byStoreName,
  searchModules,
  findIn,
  findByFactorySourceExport,
  getWebpackFactorySource,
  getWebpackModuleById,
  initWebpack,
  waitForMainWebpack,
} from "../../src/renderer/core/webpack";

describe("webpack finders", () => {
  const modules = [
    { sendMessage: () => {}, editMessage: () => {} },
    { getChannel: () => {} },
    { renderRow: function namedRow() { return "deleted-tag"; } },
  ];

  it("byProps matches a module exporting all named props", () => {
    const found = searchModules(modules, byProps("sendMessage", "editMessage"));
    expect(found).toBe(modules[0]);
  });

  it("byProps returns undefined when no module matches", () => {
    expect(searchModules(modules, byProps("nope"))).toBeUndefined();
  });

  it("byCode matches a module whose function source contains a fragment", () => {
    const found = searchModules(modules, byCode("deleted-tag"));
    expect(found).toBe(modules[2]);
  });
});

describe("findIn — mangled export drilling", () => {
  it("drills into a module exported under a mangled key", () => {
    // Discord's bundler ships a store as `exports.Z`, not `exports.default`.
    const store = { getMessage: () => {}, getMessages: () => {} };
    const found = findIn([{ Z: store }], byProps("getMessage", "getMessages"));
    expect(found).toBe(store);
  });

  it("returns the module itself when it matches directly", () => {
    const mod = { sendMessage: () => {} };
    expect(findIn([mod], byProps("sendMessage"))).toBe(mod);
  });

  it("still finds `.default` exports", () => {
    const store = { getGuild: () => {}, getGuilds: () => {} };
    expect(findIn([{ default: store }], byProps("getGuild", "getGuilds"))).toBe(store);
  });

  it("returns undefined when nothing matches", () => {
    expect(findIn([{ Z: { foo: 1 } }], byProps("bar"))).toBeUndefined();
  });

  it("byStoreName matches a Flux store by getName(), not by method props", () => {
    // A decoy helper exposes the same method pair but is not a store.
    const decoy = { getMessage: () => {}, getMessages: () => {} };
    const store = { getName: () => "MessageStore", getMessage: () => {}, getMessages: () => {} };
    expect(searchModules([decoy, store], byStoreName("MessageStore"))).toBe(store);
    expect(searchModules([decoy], byStoreName("MessageStore"))).toBeUndefined();
  });

  it("byStoreName survives a getName() that throws", () => {
    const evil = { getName: () => { throw new Error("nope"); } };
    const store = { getName: () => "ChannelStore" };
    expect(searchModules([evil, store], byStoreName("ChannelStore"))).toBe(store);
  });

  it("survives modules with throwing getters", () => {
    const evil = {};
    Object.defineProperty(evil, "boom", { get() { throw new Error("nope"); }, enumerable: true });
    const store = { getUser: () => {} };
    expect(findIn([evil, { Z: store }], byProps("getUser"))).toBe(store);
  });
});

describe("webpack factory wrapping", () => {
  it("reads the original Discord factory source through a wrapper", () => {
    const original = function discordFactory() { return "GUILD_ONBOARDING_QUESTION"; };
    const wrapper = () => undefined;
    Object.defineProperty(wrapper, Symbol.for("discreate.originalWebpackFactory"), {
      value: original,
    });

    expect(getWebpackFactorySource(wrapper)).toContain("GUILD_ONBOARDING_QUESTION");
    expect(getWebpackFactorySource(wrapper)).not.toContain("undefined");
  });

  it("selects Discord's main /assets/ runtime over an auxiliary runtime", async () => {
    const action = function markGuildsRead() {
      return "getSelectableChannelIds GUILD_ONBOARDING_QUESTION MARK_AS_READ";
    };
    const factory = function discordFactory() {
      return "getSelectableChannelIds GUILD_ONBOARDING_QUESTION MARK_AS_READ";
    };
    const fakeRequire: any = () => ({ A: action });
    fakeRequire.c = {};
    fakeRequire.m = { 42: factory };
    const chunk: any[] = [];
    chunk.push = ((item: any) => {
      item[2]?.(fakeRequire);
      return 1;
    }) as any;
    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = { webpackChunkdiscord_app: chunk };

    try {
      initWebpack();
      expect(findByFactorySourceExport(
        "getSelectableChannelIds",
        "GUILD_ONBOARDING_QUESTION",
        "MARK_AS_READ",
      )).toBe(action);
      expect(getWebpackModuleById(42)?.A).toBe(action);

      const mainAction = function mainMarkGuildsRead() {
        return "getSelectableChannelIds GUILD_ONBOARDING_QUESTION MARK_AS_READ";
      };
      const mainRequire: any = () => ({ A: mainAction });
      mainRequire.m = { 42: factory };
      mainRequire.c = {};
      mainRequire.e = () => Promise.resolve();
      mainRequire.p = "/assets/";
      await waitForMainWebpack(100);

      expect(getWebpackModuleById(42)?.A).toBe(mainAction);
    } finally {
      (globalThis as any).window = previousWindow;
    }
  });
});
