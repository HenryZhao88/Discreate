import { describe, it, expect } from "vitest";
import { before, after, instead, unpatchAll } from "../../src/renderer/core/patcher";

describe("patcher", () => {
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
});
