/**
 * Reads events from the DB graph.
 *
 * Model (logseq DB ground truth): a calendar event is a block whose `:logseq.property/scheduled`
 * holds the start and whose `:logseq.property/deadline` optionally holds the end. A value is either
 * an epoch-ms number (timed) or a reference to the day's journal page (date-only / all-day).
 *
 * Two plain conjunctive queries — the shapes proven by logseq's own worker
 * (frontend.worker.handler.property/get-date-scheduled-or-deadlines) and logseq-planner — are unioned
 * in JS: one over the ms range for timed events, one over the journal-day range for all-day events.
 */
import type { CalEvent } from "./types";

export const SCHEDULED = ":logseq.property/scheduled";
export const DEADLINE = ":logseq.property/deadline";

/** Values above this are epoch ms; below are journal-page db ids (refs). Raw DB values are never day ints. */
const TIMED_MS = 10000000000; // 1e10: day ints top out ~1e8, epoch ms runs ~1.7e12 in the 2020s

const isMs = (v: unknown): v is number => typeof v === "number" && v > TIMED_MS;

/** Pull spec shared by both range queries (EDN: map specs without quotes or commas).
    Status is always a ref (or nil), so a map spec resolving its ident is uniform. */
const PULL_EDN =
  ":block/uuid :block/title :block/marker :block/created-at "
  + SCHEDULED + " " + DEADLINE + " "
  + "{:logseq.property/status [:db/ident]} "
  + "{:block/page [:db/id :block/name :block/journal-day]}";

const RECYCLE_FILTER =
  "(not [?b :logseq.property/deleted-at _])\n"
  + "  (not-join [?b] [?b :block/page ?pg] [?pg :logseq.property/deleted-at _])";

/**
 * Pulled keys are serialized by logseq's `normalize-keyword-for-json` (datascript_query calls it
 * with camel-case? = false): `block`/`db`/`file` namespaces become the name part only
 * (`:block/uuid` → "uuid", `:db/id` → "id", `:block/journal-day` → "journal-day"), every other
 * namespace keeps the full ident with its colon (`:logseq.property/scheduled`). camelCase
 * variants are accepted too in case the DSL `q` path (camel-case? = true) serves the rows.
 */
function pick<T = unknown>(row: Record<string, unknown>, key: string): T | undefined {
  const bare = key.slice(1);
  const slash = bare.indexOf("/");
  const name = slash >= 0 ? bare.slice(slash + 1) : bare;
  const camel = name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  for (const k of [key, bare, name, camel]) {
    const v = row[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

/** `:db/id` / `:db/ident` serialize as bare `id` / `ident`. */
function identOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const ident = o["ident"] ?? o[":db/ident"];
    if (typeof ident === "string") return ident;
  }
  return undefined;
}

/** One `:find (pull ?b [...])` row: a one-element array holding the pulled map. */
type PullRows = Array<[Record<string, unknown>]>;

const DONEISH = /(\.done|\.canceled)$/;
const DONE_MARKERS = new Set(["done", "canceled"]);

/** journal-day int (20261027) of a local Date. */
export function journalDayOf(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Local noon "YYYY-MM-DDT12:00:00" — the createJournalPage argument that survives timezones. */
export function localNoonArg(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T12:00:00`;
}

/** A pulled event row after normalization. */
interface RawRow {
  uuid: string;
  title: string;
  marker?: string;
  /** Start: epoch ms (timed) or journal-day int (all-day, after ref resolution). Always set. */
  scheduled: number;
  /** End: same units as scheduled; undefined when absent or unresolvable. */
  deadline?: number;
  page?: { name?: string; journalDay?: number };
  status?: string;
}

/** Normalizes one pulled row; null when the row is unusable (no uuid, no title, or unresolvable start ref). */
function normalizeRow(row: Record<string, unknown>, dayOf: (id: number) => number | undefined): RawRow | null {
  const uuid = pick<string>(row, ":block/uuid");
  const title = pick<string>(row, ":block/title");
  if (!uuid || typeof title !== "string") return null;
  const rawScheduled = pick<number | { id: number }>(row, SCHEDULED);
  if (rawScheduled === undefined) return null;
  // Epoch ms passes through; anything smaller is a ref (map {id} or bare db id) → resolve to day int.
  const resolve = (v: number | { id: number }): number | undefined =>
    typeof v === "number" ? (isMs(v) ? v : dayOf(v)) : dayOf(v.id);
  const scheduled = resolve(rawScheduled);
  if (scheduled === undefined) return null;

  const rawDeadline = pick<number | { id: number }>(row, DEADLINE);
  const deadline = rawDeadline === undefined ? undefined : resolve(rawDeadline);

  const pageRaw = pick<Record<string, unknown>>(row, ":block/page");
  const page =
    pageRaw && typeof pageRaw === "object"
      ? {
        name: pick<string>(pageRaw, ":block/name"),
        journalDay: pick<number>(pageRaw, ":block/journal-day"),
      }
      : undefined;

  const statusIdent = identOf(pick(row, ":logseq.property/status"));
  const marker = pick<string>(row, ":block/marker") ?? undefined;
  return { uuid, title, marker, scheduled, deadline, page, status: statusIdent };
}

function toCalEvent(r: RawRow): CalEvent {
  const done = DONEISH.test(r.status ?? "") || DONE_MARKERS.has(r.marker ?? "");
  if (isMs(r.scheduled)) {
    const startMs = r.scheduled;
    const endMs = isMs(r.deadline) ? r.deadline : null;
    return {
      uuid: r.uuid,
      title: r.title,
      allDay: false,
      startMs,
      end: endMs !== null && endMs > startMs ? endMs : null,
      done,
      journalDay: r.page?.journalDay ?? null,
      pageName: r.page?.name ?? null,
    };
  }
  // All-day: scheduled is the start day int; deadline (when a day int, not ms) the inclusive last day.
  const startDay = r.scheduled;
  const endDay = typeof r.deadline === "number" && !isMs(r.deadline) ? r.deadline : null;
  return {
    uuid: r.uuid,
    title: r.title,
    allDay: true,
    startMs: startDay,
    end: endDay !== null && endDay >= startDay ? endDay : null,
    done,
    journalDay: r.page?.journalDay ?? null,
    pageName: r.page?.name ?? null,
  };
}

/** Resolves a batch of journal-page db ids to their journal-day ints. */
async function dayResolver(
  dq: (query: string, ...inputs: unknown[]) => Promise<unknown>,
  ids: number[],
): Promise<(id: number) => number | undefined> {
  const map = new Map<number, number>();
  if (ids.length) {
    const rows = (await dq(
      "[:find ?id ?day :in $ [?id ...] :where [?id :block/journal-day ?day]]",
      [...new Set(ids)],
    )) as Array<[number, number]>;
    for (const [id, day] of rows ?? []) map.set(id, day);
  }
  return (id) => map.get(id);
}

/** Queries timed + all-day events over [start, end) (FullCalendar sends Date bounds, end exclusive). */
export async function fetchEvents(
  dq: (query: string, ...inputs: unknown[]) => Promise<unknown>,
  start: Date,
  end: Date,
): Promise<CalEvent[]> {
  const timedQuery =
    `[:find (pull ?b [${PULL_EDN}])\n`
    + `  :in $ ?startMs ?endMs\n  :where\n  [?b :block/uuid]\n`
    + `  [?b ${SCHEDULED} ?n]\n  [(>= ?n ?startMs)]\n  [(<= ?n ?endMs)]\n  ${RECYCLE_FILTER}]`;
  const allDayQuery =
    `[:find (pull ?b [${PULL_EDN}])\n`
    + `  :in $ ?startDay ?endDay\n  :where\n  [?b :block/uuid]\n`
    + `  [?b ${SCHEDULED} ?ref]\n  [?ref :block/journal-day ?day]\n`
    + `  [(>= ?day ?startDay)]\n  [(<= ?day ?endDay)]\n  ${RECYCLE_FILTER}]`;

  const [timedRows, allDayRows] = (await Promise.all([
    dq(timedQuery, start.getTime(), end.getTime()),
    dq(allDayQuery, journalDayOf(start), journalDayOf(new Date(end.getTime() - 1))),
  ])) as PullRows[];

  const refIds: number[] = [];
  for (const rows of [timedRows, allDayRows]) {
    for (const row of rows ?? []) {
      const map = row?.[0];
      if (!map || typeof map !== "object") continue;
      for (const key of [SCHEDULED, DEADLINE]) {
        const v = pick<number | { id: number }>(map, key);
        if (v && typeof v === "object") refIds.push(v.id);
      }
    }
  }
  const dayOf = await dayResolver(dq, refIds);

  const out: CalEvent[] = [];
  const seen = new Set<string>();
  for (const rows of [timedRows, allDayRows]) {
    for (const row of rows ?? []) {
      const map = row?.[0];
      if (!map || typeof map !== "object") continue;
      const raw = normalizeRow(map, dayOf);
      if (!raw || seen.has(raw.uuid)) continue;
      seen.add(raw.uuid);
      out.push(toCalEvent(raw));
    }
  }
  return out;
}
