import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveReactDOM } from "../../src/renderer/core/react-dom";

const fixture = vi.hoisted(() => ({ modules: [] as any[] }));
vi.mock("../../src/renderer/core/webpack", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/renderer/core/webpack")>(),
  findAll: (filter: any) => fixture.modules.filter(filter),
}));
beforeEach(() => { fixture.modules = []; });

describe("ReactDOM provider resolution", () => {
  it("resolves the React 19 client without hydration or legacy exports, preserving identity", () => {
    const client = { createRoot() {} };
    fixture.modules = [{ createRoot: {}, hydrateRoot: {} }, { render: {}, unmountComponentAtNode: {} }, client];
    expect(resolveReactDOM("19.2.3")).toBe(client);
  });
  it("rejects dynamic and populated compatibility proxies", () => {
    const stub = new Proxy(function () {}, { get: () => stub });
    const proxy = new Proxy({}, { get: () => stub });
    const populated = { createRoot: stub, render: stub, unmountComponentAtNode: stub };
    const client = { createRoot() {} };
    fixture.modules = [proxy, populated, client];
    expect(resolveReactDOM("19.2.3")).toBe(client);
  });
  it("ignores localization proxies that cache callable properties on access", () => {
    const cached: Record<PropertyKey, any> = { createRoot: () => undefined };
    const intl = new Proxy(cached, { get: (target, key) => {
      if (key === Symbol.toStringTag) return "IntlMessagesProxy";
      return target[key] ??= () => undefined;
    } });
    const client = { createRoot() {} };
    fixture.modules = [intl, client];
    expect(resolveReactDOM("19.2.3")).toBe(client);
    expect(Object.keys(cached)).toEqual(["createRoot"]);
  });
  it("prefers the renderer matching the active React version", () => {
    const old = { version: "18.3.1", createRoot() {} };
    const client = { version: "19.2.3", createRoot() {} };
    fixture.modules = [old, client];
    expect(resolveReactDOM("19.2.3")).toBe(client);
  });
  it("supports legacy clients and avoids ambiguous instances", () => {
    const legacy = { render() {}, unmountComponentAtNode() {} };
    fixture.modules = [legacy];
    expect(resolveReactDOM()).toBe(legacy);
    fixture.modules = [{ createRoot() {} }, { createRoot() {} }];
    expect(() => resolveReactDOM()).toThrow("Multiple ReactDOM clients");
  });
});
