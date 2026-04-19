import type { InboxMessage } from "@/db/schema-inbox";

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        normalizeValue(entry),
      ])
    );
  }

  return value;
}

export function normalizeInboxMessage(row: InboxMessage | undefined | null): InboxMessage | null {
  if (!row) return null;
  return normalizeValue(row) as InboxMessage;
}

export function normalizeInboxMessages(rows: InboxMessage[]): InboxMessage[] {
  return rows.map((row) => normalizeInboxMessage(row)).filter(Boolean) as InboxMessage[];
}
