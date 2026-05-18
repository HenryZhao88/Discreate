import { describe, it, expect } from "vitest";
import { byProps, byCode, byStoreName, searchModules, findIn } from "../../src/renderer/core/webpack";

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
