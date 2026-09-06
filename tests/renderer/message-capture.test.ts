// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../../src/renderer/plugins/viewDeletedMessages/index";
import { Discreate } from "../../src/renderer/api/index";
import { unpatchAll } from "../../src/renderer/core/patcher";
import { editHistory } from "../../src/renderer/plugins/viewDeletedMessages/log";
const store = vi.hoisted(() => ({ getName: () => "MessageStore", getMessage: vi.fn() }));
vi.mock("../../src/renderer/core/webpack", () => ({ findStore: () => store, findByProps: () => store, findByPropsLazy: () => store }));
vi.mock("../../src/renderer/plugins/viewDeletedMessages/domLayer", () => ({
  startDomLayer() {}, stopDomLayer() {}, markDeleted() {}, unmarkDeleted() {}, setLocalDeleteHandler() {},
}));
const ctx = { id: "viewDeletedMessages", options: {}, saveOptions() {} };
let dispatch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  dispatch = vi.fn(() => Promise.resolve("dispatched"));
  Discreate.FluxDispatcher = { dispatch };
  (window as any).DiscreateNative = {
    root: "/test", appendText() {}, readDeletedLog: () => null, writeDeletedLog() {},
  };
  store.getMessage.mockImplementation((_channel, id) => id === "kept" ? { content: "message", author: { username: "fixture" } } : undefined);
});
afterEach(() => {
  plugin.stop(ctx);
  unpatchAll(ctx.id);
  editHistory.clear();
  Discreate.FluxDispatcher = undefined;
  delete (window as any).DiscreateNative;
  vi.useRealTimers();
});
describe("message capture", () => {
  it("passes uncaptured messages from mixed bulk deletes through the dispatcher", async () => {
    plugin.start(ctx);
    await expect(Discreate.FluxDispatcher.dispatch({ type: "MESSAGE_DELETE_BULK", channelId: "c", ids: ["kept", "missing"] })).resolves.toBe("dispatched");
    expect(dispatch).toHaveBeenCalledWith({ type: "MESSAGE_DELETE_BULK", channelId: "c", ids: ["missing"] });
  });
  it("retains a captured message even when log persistence fails", () => {
    (window as any).DiscreateNative.writeDeletedLog = () => { throw new Error("disk full"); };
    plugin.start(ctx);
    Discreate.FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId: "c", id: "kept" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "DISCREATE_KEPT_DELETE" }));
  });
  it("restores edit history at startup", () => {
    (window as any).DiscreateNative.readDeletedLog = () => JSON.stringify({ deleted: [], edits: [
      { channelId: "c", messageId: "kept", author: "fixture", timestamp: 1, history: [{ time: 1, content: "old" }] },
    ] });
    plugin.start(ctx);
    expect(editHistory.get("kept")).toEqual([{ time: 1, content: "old" }]);
  });
});
