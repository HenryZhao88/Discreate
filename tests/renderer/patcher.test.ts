import { describe, it, expect } from "vitest";
import { before, after, instead, unpatchAll } from "../../src/renderer/core/patcher";

describe("patcher", () => {
  it("removes one owner without dropping or resurrecting another owner's patch", () => {
    const original = () => 1;
    const obj = { val: original };
    const removeA = after("a", obj, "val", (_, ret) => ret + 10);
    after("b", obj, "val", (_, ret) => ret * 2);
    expect(obj.val()).toBe(22);
    removeA();
    expect(obj.val()).toBe(2);
    removeA();
    expect(obj.val()).toBe(2);
    unpatchAll("b");
    unpatchAll("a");
    expect(obj.val).toBe(original);
  });

  it("restores inherited methods without leaving an own property", () => {
    const proto = { val(this: { n: number }): number { return this.n; } };
    const obj = Object.assign(Object.create(proto), { n: 7 });
    after("inherit", obj, "val", (_, ret) => ret + 1);
    expect(obj.val()).toBe(8);
    unpatchAll("inherit");
    expect(Object.hasOwn(obj, "val")).toBe(false);
    expect(obj.val()).toBe(7);
  });
  it("before can modify arguments", () => {
    const obj = { add: (a: number, b: number) => a + b };
    before("t", obj, "add", (args) => { args[0] = 10; });
    expect(obj.add(1, 2)).toBe(12);
    unpatchAll("t");
  });

  it("after can modify the return value", () => {
    const obj = { val: () => 5 };
    after("t", obj, "val", (_args, ret) => ret * 2);
    expect(obj.val()).toBe(10);
    unpatchAll("t");
  });

  it("instead replaces the function with access to original", () => {
    const obj = { greet: (n: string) => `hi ${n}` };
    instead("t", obj, "greet", (args, orig) => orig(args[0]).toUpperCase());
    expect(obj.greet("bob")).toBe("HI BOB");
    unpatchAll("t");
  });

  it("unpatchAll restores original behavior", () => {
    const obj = { val: () => 5 };
    after("t", obj, "val", () => 99);
    unpatchAll("t");
    expect(obj.val()).toBe(5);
  });

  it("unpatchAll restores correctly when multiple patches stack on one key", () => {
    const obj = { val: () => 1 };
    before("t", obj, "val", () => {});
    after("t", obj, "val", (_args, ret) => ret + 100);
    instead("t", obj, "val", (_args, orig) => orig() * 2);
    unpatchAll("t");
    expect(obj.val()).toBe(1);
  });
});
