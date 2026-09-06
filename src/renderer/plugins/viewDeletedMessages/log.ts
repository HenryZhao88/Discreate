// src/renderer/plugins/viewDeletedMessages/log.ts
// Pure data helpers + persistence for the Message Logger plugin.
import { native } from "../../core/paths.js";

export interface DeletedRecord {
  channelId: string;
  messageId: string;
  author: string;
  content: string;
  timestamp: number;
}

export interface EditEntry {
  time: number;
  content: string;
}

export interface EditRecord {
  channelId: string;
  messageId: string;
  author: string;
  history: EditEntry[];
  timestamp: number;
}

export interface LogFile {
  deleted: DeletedRecord[];
  edits: EditRecord[];
}

/** Keep only the last `cap` entries of a list. */
export function capEntries<T>(entries: T[], cap: number): T[] {
  cap = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 500;
  return entries.length > cap ? entries.slice(entries.length - cap) : entries;
}

/**
 * Build an edit-history entry from the pre-edit message and the incoming
 * updated message. Returns null when this MESSAGE_UPDATE is not a real content
 * edit (embed loads and similar fire MESSAGE_UPDATE with unchanged content).
 */
export function makeEditEntry(oldMsg: any, newMsg: any): EditEntry | null {
  if (!oldMsg || !newMsg) return null;
  if (!newMsg.edited_timestamp) return null;
  // A partial MESSAGE_UPDATE can omit `content`; that is not a content edit.
  if (newMsg.content === undefined) return null;
  if (oldMsg.content === newMsg.content) return null;
  const parsed = Date.parse(newMsg.edited_timestamp);
  return {
    time: Number.isNaN(parsed) ? Date.now() : parsed,
    content: oldMsg.content ?? "",
  };
}

/** Parse the on-disk log, migrating the legacy bare-array format. */
export function parseLogFile(raw: string | null): LogFile {
  if (!raw) return { deleted: [], edits: [] };
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { deleted: [], edits: [] };
  }
  if (data === null || typeof data !== "object") return { deleted: [], edits: [] };
  const validRecord = (rec: any) => rec && typeof rec.channelId === "string" &&
    typeof rec.messageId === "string" && typeof rec.author === "string" && Number.isFinite(rec.timestamp);
  const deleted = (items: any[]) => items.filter((rec) => validRecord(rec) && typeof rec.content === "string");
  const edits = (items: any[]) => items.filter((rec) => validRecord(rec) && Array.isArray(rec.history))
    .map((rec) => ({ ...rec, history: rec.history.filter((entry: any) => entry && Number.isFinite(entry.time) && typeof entry.content === "string") }));
  if (Array.isArray(data)) return { deleted: deleted(data), edits: [] };
  return {
    deleted: Array.isArray(data.deleted) ? deleted(data.deleted) : [],
    edits: Array.isArray(data.edits) ? edits(data.edits) : [],
  };
}

export function serializeLogFile(log: LogFile): string {
  return JSON.stringify(log, null, 2);
}

// --- stateful persistence --------------------------------------------------

/** In-memory edit history, keyed by message id (oldest edit first). */
export const editHistory = new Map<string, EditEntry[]>();

export function readLog(): LogFile {
  return parseLogFile(native().readDeletedLog());
}

function writeLog(log: LogFile): void {
  native().writeDeletedLog(serializeLogFile(log));
}

/** The configured cap applies across both kinds of records. */
function capLog(log: LogFile, cap: number): LogFile {
  const kept = new Set(capEntries([...log.deleted, ...log.edits].sort((a, b) => a.timestamp - b.timestamp), cap));
  return { deleted: log.deleted.filter((rec) => kept.has(rec)), edits: log.edits.filter((rec) => kept.has(rec)) };
}

/** Append a deleted-message record, capping total deleted entries. */
export function recordDeleted(rec: DeletedRecord, cap: number): void {
  const log = readLog();
  log.deleted = log.deleted.filter((entry) => entry.messageId !== rec.messageId);
  log.deleted.push(rec);
  writeLog(capLog(log, cap));
}

/** Append/replace an edit record for a message, capping total edit entries. */
export function recordEdit(rec: EditRecord, cap: number): void {
  const log = readLog();
  const existing = log.edits.findIndex((e) => e.messageId === rec.messageId);
  if (existing >= 0) log.edits[existing] = rec;
  else log.edits.push(rec);
  writeLog(capLog(log, cap));
}

/** Remove a deleted record by message id (used by "delete locally"). */
export function removeDeleted(messageId: string): void {
  const log = readLog();
  log.deleted = log.deleted.filter((d) => d.messageId !== messageId);
  writeLog(log);
}

/** Remove an edit record by message id (used by "delete locally"). */
export function removeEdit(messageId: string): void {
  const log = readLog();
  log.edits = log.edits.filter((e) => e.messageId !== messageId);
  writeLog(log);
}

export function clearLog(): void {
  writeLog({ deleted: [], edits: [] });
  editHistory.clear();
}
