import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

function migrationInventory() {
  const migrationsDir = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  const sqlTags = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, -4))
    .sort();

  return { entries: journal.entries, sqlTags };
}

describe("Drizzle migration journal", () => {
  it("registers every SQL migration exactly once", () => {
    const { entries, sqlTags } = migrationInventory();
    const journalTags = entries.map((entry) => entry.tag).sort();

    expect(new Set(journalTags).size).toBe(journalTags.length);
    expect(journalTags).toEqual(sqlTags);
  });

  it("keeps journal indices and timestamps strictly increasing", () => {
    const { entries } = migrationInventory();

    expect(entries.map((entry) => entry.idx)).toEqual(
      entries.map((_, index) => index),
    );
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index].when).toBeGreaterThan(entries[index - 1].when);
    }
  });
});
