import { describe, it, expect, vi } from "vitest";
import { capEntries, makeEditEntry, parseLogFile, serializeLogFile, recordDeleted, recordEdit, readLog } from "../../src/renderer/plugins/viewDeletedMessages/log";

describe("capEntries", () => {
  it("keeps only the last `cap` entries", () => {
    expect(capEntries([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
  it("returns the list unchanged when under the cap", () => {
    expect(capEntries([1, 2], 5)).toEqual([1, 2]);
  });
});

describe("makeEditEntry", () => {
  it("returns an entry when content changed and edited_timestamp is set", () => {
    const oldMsg = { content: "hello" };
    const newMsg = { content: "hello world", edited_timestamp: "2026-05-18T00:00:00.000Z" };
    expect(makeEditEntry(oldMsg, newMsg)).toEqual({
      time: Date.parse("2026-05-18T00:00:00.000Z"),
      content: "hello",
    });
  });
  it("returns null when content is unchanged (e.g. embed load)", () => {
    const oldMsg = { content: "hello" };
    const newMsg = { content: "hello", edited_timestamp: "2026-05-18T00:00:00.000Z" };
    expect(makeEditEntry(oldMsg, newMsg)).toBeNull();
  });
  it("returns null when there is no edited_timestamp", () => {
    expect(makeEditEntry({ content: "a" }, { content: "b" })).toBeNull();
  });
});

describe("parseLogFile", () => {
  it("rejects invalid log and record shapes without crashing", () => {
    for (const raw of ["null", "12", '{"deleted":[null,{}],"edits":[null,{}]}']) {
      expect(parseLogFile(raw)).toEqual({ deleted: [], edits: [] });
    }
  });
  it("deduplicates deletions and caps deleted plus edited records together", () => {
    let raw: string | null = null;
    vi.stubGlobal("window", { DiscreateNative: { readDeletedLog: () => raw, writeDeletedLog: (value: string) => { raw = value; } } });
    try {
      const rec = { channelId: "c", messageId: "1", author: "a", content: "text", timestamp: 1 };
      recordDeleted(rec, 2);
      recordDeleted(rec, 2);
      expect(readLog().deleted).toHaveLength(1);
      recordEdit({ ...rec, messageId: "2", history: [], timestamp: 2 }, 2);
      recordDeleted({ ...rec, messageId: "3", timestamp: 3 }, 2);
      expect(readLog().deleted.map((r) => r.messageId)).toEqual(["3"]);
      expect(readLog().edits).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it("returns empty log for null/garbage input", () => {
    expect(parseLogFile(null)).toEqual({ deleted: [], edits: [] });
    expect(parseLogFile("{not json")).toEqual({ deleted: [], edits: [] });
  });
  it("migrates the legacy bare-array format into { deleted, edits }", () => {
    const legacy = JSON.stringify([{ channelId: "c", messageId: "m", author: "a", content: "x", timestamp: 1 }]);
    expect(parseLogFile(legacy)).toEqual({
      deleted: [{ channelId: "c", messageId: "m", author: "a", content: "x", timestamp: 1 }],
      edits: [],
    });
  });
  it("round-trips a structured log file", () => {
    const log = { deleted: [], edits: [{ channelId: "c", messageId: "m", author: "a", history: [{ time: 1, content: "x" }], timestamp: 2 }] };
    expect(parseLogFile(serializeLogFile(log))).toEqual(log);
  });
});
