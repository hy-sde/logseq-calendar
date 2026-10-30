# logseq-calendar

A month/week/day/list calendar for Logseq DB graphs, styled after the Obsidian fullcalendar plugin: it opens from a top-right toolbar button as a docked side panel, and events live in your daily notes.

## How it works

- **Open**: click the calendar icon in Logseq's top toolbar (or command palette → "Calendar: open"). The panel docks to the right edge; drag its left edge to resize (420–980 px, persisted).
- **Create**: click any empty slot (or drag across slots), fill the form, save. The event block is appended to that day's journal page.
- **Edit**: click an event. Drag / resize moves it. Delete from the edit form.
- **Storage**: an event is a journal block whose content is the title, with `:logseq.property/scheduled` (start) and optionally `:logseq.property/deadline` (end) — epoch ms for timed events, a reference to the day's journal page for all-day events. The same properties the built-in planner/scheduler features use, so events stay visible in Logseq's own property views.
- **Live refresh**: the calendar refetches (debounced) whenever the graph changes.
- **Theme**: follows the host theme's CSS tokens; dark and light both supported.

## Build & install

Requires Node ≥ 22. Either build from source:

```
git clone https://github.com/hy-sde/logseq-calendar
cd logseq-calendar
npm i
npm run build
mkdir -p ~/.logseq/plugins/logseq-calendar
cp -R dist icon.svg package.json LICENSE ~/.logseq/plugins/logseq-calendar/
```

Then restart Logseq and enable "Calendar" under Settings → Plugins. DB graphs only (`supportsDBOnly: true`).

## Layout

- `src/index.ts` — entry; defers registration until `logseq.ready`
- `src/sdk.ts` — the only file that touches `logseq.*`; exposes `appDeps()`
- `src/query.ts` — datalog reads (timed ms-range query + all-day journal-day-range query, unioned)
- `src/editor.ts` — journal-page ensure/create + block append/update/property writes
- `src/calendar.ts` — FullCalendar mount (daygrid, timegrid, list, interaction)
- `src/form.ts` — the event modal
- `src/app.ts` — dock, toolbar button, resize, refresh wiring
- `src/theme.ts` — host token mapping
- `src/ui.css` — `--lc-*` tokens + FullCalendar variable overrides

## Credits

- [FullCalendar](https://github.com/fullcalendar/fullcalendar) — the calendar engine powering all views (month/week/day/list, drag & drop). MIT licensed; its license notice is included in [LICENSE](LICENSE).
- [logseq-planner](https://github.com/hdansou/logseq-planner) — reference for the DB-graph read/write patterns and plugin packaging.
