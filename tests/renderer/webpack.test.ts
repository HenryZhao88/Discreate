import { describe, it, expect } from "vitest";
import { byProps, byCode, searchModules } from "../../src/renderer/core/webpack";

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
