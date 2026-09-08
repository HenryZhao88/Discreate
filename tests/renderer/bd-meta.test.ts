import { describe, it, expect } from "vitest";
import { parseBdMeta, stripCcOn } from "../../src/renderer/core/plugins";
import { __test as BdUtilsTest } from "../../src/renderer/api/bd-api";

const HEADER = `/**
 * @name MessageLoggerV2
 * @version 1.10.2
 * @invite NYvWdN5
 * @author Lighty
 * @description Saves all deleted and purged messages.
 */
/*@cc_on
@if (@_jscript)
  // Windows JScript junk
  WScript.Quit();
@else @*/
module.exports = class MessageLoggerV2 {};
/*@end @*/
`;

describe("BD meta parser", () => {
  it("extracts name/version/description/author from JSDoc", () => {
    const meta = parseBdMeta(HEADER);
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("MessageLoggerV2");
    expect(meta!.version).toBe("1.10.2");
    expect(meta!.author).toBe("Lighty");
    expect(meta!.description).toMatch(/Saves all deleted/);
  });

  it("returns null when no JSDoc block is present", () => {
    expect(parseBdMeta("module.exports = {};")).toBeNull();
  });

  it("strips the @cc_on JScript IIFE", () => {
    const out = stripCcOn(HEADER);
    expect(out).not.toMatch(/WScript/);
    expect(out).toMatch(/module\.exports = class MessageLoggerV2/);
  });
});

describe("BdApi.Utils pure helpers", () => {
  const { findInTree, getNestedValue, semverCompare } = BdUtilsTest;

  it("findInTree walks objects and returns first match", () => {
    const tree = { a: { b: { c: { target: true, val: 42 } } } };
    const hit = findInTree(tree, (n: any) => n?.target === true);
    expect(hit?.val).toBe(42);
  });

  it("findInTree honors walkable", () => {
    const tree = { props: { val: 1 }, other: { val: 2 } };
    const hit = findInTree(tree, (n: any) => typeof n?.val === "number", { walkable: ["props"] });
    expect(hit?.val).toBe(1);
  });

  it("walks React child arrays even when walkable only names props and children", () => {
    const wanted = { key: "target", props: {} };
    const tree: any = { props: { children: [{ props: { children: [wanted] } }] } };
    tree.props.children.push(tree);
    expect(findInTree(tree, (n: any) => n?.key === "target", { walkable: ["props", "children"] })).toBe(wanted);
  });

  it("returns the first match in property order and skips throwing getters", () => {
    const wanted = { target: true, order: 1 };
    const tree = { get broken() { throw new Error("unavailable"); }, a: wanted, b: { target: true, order: 2 } };
    expect(findInTree(tree, (n: any) => n?.target)).toBe(wanted);
  });

  it("findInTree returns null when nothing matches", () => {
    expect(findInTree({ a: 1 }, () => false)).toBeNull();
  });

  it("getNestedValue resolves dotted paths", () => {
    expect(getNestedValue({ a: { b: { c: 7 } } }, "a.b.c")).toBe(7);
    expect(getNestedValue({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(getNestedValue(null, "a")).toBeUndefined();
  });

  it("semverCompare orders versions correctly", () => {
    expect(semverCompare("1.2.3", "1.2.3")).toBe(0);
    expect(semverCompare("1.2.4", "1.2.3")).toBe(1);
    expect(semverCompare("1.2.3", "1.2.4")).toBe(-1);
    expect(semverCompare("1.10.0", "1.2.0")).toBe(1);
    expect(semverCompare("2.0.0", "1.99.99")).toBe(1);
  });
});
