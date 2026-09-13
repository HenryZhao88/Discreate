// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { installBdApi } from "../../src/renderer/api/bd-api";
import { byProps, findIn } from "../../src/renderer/core/webpack";

describe("host module discovery", () => {
  it("requires declared properties rather than arbitrary bridge proxy responses", () => {
    const bridge = new Proxy({}, { get: () => () => "placeholder" });
    const actual = { ConfirmModal: () => null };
    expect(findIn([{ Z: bridge }, { Z: actual }], byProps("ConfirmModal"))).toBe(actual);
    const inherited = Object.create({ parse: () => "parsed" });
    expect(byProps("parse")(inherited)).toBe(true);
  });
  it("skips the compatibility API, its scoped instances, and its arbitrary property stubs", () => {
    const api = installBdApi();
    const parser = { parse: () => "parsed", parseTopic: () => "topic" };
    const modules = [{ Z: api }, { Z: new api("test") }, { Z: api.unknown }, { Z: parser }];
    expect(findIn(modules, byProps("parse", "parseTopic"))).toBe(parser);
    expect(findIn(modules, (m) => typeof m.parse === "function")).toBe(parser);
  });
  it("skips localization proxies before invoking arbitrary caller filters", () => {
    const proxy = new Proxy({}, { get: (_t, key) => key === Symbol.toStringTag ? "IntlMessagesProxy" : () => "localized" });
    const parser = { parse: () => "parsed" };
    expect(findIn([{ Z: proxy }, { Z: parser }], (m) => typeof m.parse === "function")).toBe(parser);
  });
});
