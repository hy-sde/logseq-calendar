/**
 * Writes events into the graph.
 *
 * An event is a block on the event's journal page: the block's content is the title, and the date
 * properties carry the times. `upsertBlockProperty` takes epoch ms for a datetime value and the
 * journal page's db id for a date-only value (proven by logseq-planner's date writes); the journal
 * page is looked up by `:block/journal-day` — `createJournalPage`'s return value is unreliable on
 * the stable app, so the call is only made to create a missing page, followed by a poll.
 */
import { DEADLINE, SCHEDULED, journalDayOf, localNoonArg } from "./query";
import type { EventDraft, WriteDeps } from "./types";

/** How often / how far apart a freshly created journal page is looked for. */
const JOURNAL_PAGE_TRIES = 10;
const JOURNAL_PAGE_WAIT_MS = 100;

export interface JournalPage {
  id: number; // db id — the date-property value for all-day events
  uuid: string; // the appendBlockInPage target
}

/** journal-day lookup returning both the db id and the page uuid. */
const pageQuery = (day: number) =>
  `[:find ?p ?u :where [?p :block/journal-day ${day}] [?p :block/uuid ?u]]`;

async function findJournalPage(write: WriteDeps, day: number): Promise<JournalPage | null> {
  try {
    const rows = (await write.dq(pageQuery(day))) as Array<[number, string]>;
    if (rows?.length) {
      let best: [number, string] | null = null;
      for (const row of rows) if (!best || row[0] < best[0]) best = row; // duplicate days: the lowest db id wins
      return best ? { id: best[0], uuid: best[1] } : null;
    }
  } catch {
    // fall through to create
  }
  return null;
}

/** The event's journal page, existing or created (poll after the create call). */
export async function ensureJournalPage(write: WriteDeps, day: number): Promise<JournalPage | null> {
  const existing = await findJournalPage(write, day);
  if (existing) return existing;
  const noon = new Date(Math.floor(day / 10000), Math.floor((day % 10000) / 100) - 1, day % 100, 12, 0, 0, 0);
  try {
    await write.createJournalPage(localNoonArg(noon));
  } catch {
    // the poll decides the outcome
  }
  for (let i = 0; i < JOURNAL_PAGE_TRIES; i++) {
    const created = await findJournalPage(write, day);
    if (created) return created;
    await new Promise((r) => setTimeout(r, JOURNAL_PAGE_WAIT_MS));
  }
  return null;
}

/** One line of text: the block content and the event title are the same string. */
const toTitle = (s: string): string => s.replace(/\s*\n+\s*/g, " ").trim();

export async function createEvent(write: WriteDeps, draft: EventDraft): Promise<string> {
  const title = toTitle(draft.title);
  if (!title) throw new Error("The event needs a title.");
  const page = await ensureJournalPage(write, journalDayOf(draft.start));
  if (!page) throw new Error("Logseq gave no journal page for the event's day.");
  const uuid = await write.appendBlock(page.uuid, title);
  if (!uuid) throw new Error("Logseq did not create the event block.");
  await applyTimes(write, uuid, draft);
  return uuid;
}

export async function updateEvent(write: WriteDeps, uuid: string, draft: EventDraft): Promise<void> {
  const title = toTitle(draft.title);
  if (!title) throw new Error("The event needs a title.");
  await write.updateBlock(uuid, title);
  await applyTimes(write, uuid, draft);
}

/** Sets scheduled/deadline per the draft: ms for timed, the journal page's db id for all-day. */
async function applyTimes(write: WriteDeps, uuid: string, draft: EventDraft): Promise<void> {
  if (draft.allDay) {
    const startPage = await ensureJournalPage(write, journalDayOf(draft.start));
    if (!startPage) throw new Error("Logseq gave no journal page for the event's day.");
    await write.upsertBlockProperty(uuid, SCHEDULED, startPage.id);
    const endDay = draft.end ? journalDayOf(draft.end) : null;
    if (endDay !== null && endDay !== journalDayOf(draft.start)) {
      const endPage = await ensureJournalPage(write, endDay);
      if (!endPage) throw new Error("Logseq gave no journal page for the event's end day.");
      await write.upsertBlockProperty(uuid, DEADLINE, endPage.id);
    } else {
      await write.removeBlockProperty(uuid, DEADLINE);
    }
  } else {
    const startMs = draft.start.getTime();
    await write.upsertBlockProperty(uuid, SCHEDULED, startMs);
    const endMs = draft.end && draft.end.getTime() > startMs ? draft.end.getTime() : null;
    if (endMs !== null) await write.upsertBlockProperty(uuid, DEADLINE, endMs);
    else await write.removeBlockProperty(uuid, DEADLINE);
  }
}

export async function deleteEvent(write: WriteDeps, uuid: string): Promise<void> {
  await write.removeBlock(uuid);
}
