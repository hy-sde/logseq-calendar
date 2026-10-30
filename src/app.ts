/** The app: toolbar toggle, docked frame, calendar + form wiring, live refresh. */
import { dockFrame, dockHostStyle } from "./sdk";
import { mountCalendar, dayFromInt } from "./calendar";
import { createEvent, deleteEvent, updateEvent } from "./editor";
import { openForm } from "./form";
import { journalDayOf } from "./query";
import { watchTheme } from "./theme";
import type { CalEvent, EventDraft, Frame, HostDeps, ThemeDeps, WriteDeps } from "./types";

const OPEN_KEY = "open-calendar";
const OPEN_HANDLER = "toggleCalendar";
const DOCK_KEY = "calendar-dock";

/** The toolbar glyph. */
const ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 420;
const MAX_WIDTH = 980;

const storedWidth = (): number => {
  try {
    const raw = localStorage.getItem(DOCK_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  } catch {
    // defaults hold
  }
  return DEFAULT_WIDTH;
};

/** The dock style for the plugin's container: under the host header, pinned right, full height. */
const frame = (width: number, headbar: string): Frame => dockFrame(width, headbar);

export function registerApp(
  root: HTMLElement,
  deps: { host: HostDeps; write: WriteDeps; theme: ThemeDeps },
): void {
  const { host, write, theme } = deps;
  const pluginId = assertId(host.pluginId());
  const HEADBAR = "var(--ls-headbar-height, 3rem)";

  // ---- shell ----------------------------------------------------------------
  root.innerHTML = `
    <div class="lsc-panel">
      <div class="lsc-resize" title="Drag to resize"></div>
      <div class="lsc-head">
        <div class="lsc-head-title">${ICON}<span>Calendar</span></div>
        <div class="lsc-head-tools">
          <button class="lsc-ibtn" data-act="open-log" title="Open today's daily note">§</button>
          <button class="lsc-ibtn" data-act="close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="lsc-fetch-error" hidden></div>
      <div class="lsc-cal"></div>
    </div>`;
  const panel = root.querySelector<HTMLElement>(".lsc-panel")!;
  const calRoot = root.querySelector<HTMLElement>(".lsc-cal")!;

  // ---- dock -----------------------------------------------------------------
  let docked = false;
  let width = storedWidth();

  const applyDock = (px: number) => {
    host.setContainerStyle(frame(px, HEADBAR));
    host.provideStyle({ key: DOCK_KEY, style: dockHostStyle(pluginId, px) });
  };
  const open = () => {
    if (docked) return;
    docked = true;
    panel.classList.add("docked");
    applyDock(width);
    host.showMainUI();
    calendar?.updateSize();
  };
  const close = () => {
    if (!docked) return;
    docked = false;
    panel.classList.remove("docked");
    host.provideStyle({ key: DOCK_KEY, style: "" });
    host.hideMainUI();
    form?.close();
  };
  const toggle = () => (docked ? close() : open());

  // Edge resize (pointer capture keeps the drag alive past the iframe's left edge).
  const resize = root.querySelector<HTMLElement>(".lsc-resize")!;
  resize.addEventListener("pointerdown", (e) => {
    if (!docked) return;
    e.preventDefault();
    resize.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const win = host.hostWindow() ?? window;
      width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, win.innerWidth - ev.clientX));
      applyDock(width);
    };
    const up = (ev: PointerEvent) => {
      resize.releasePointerCapture(ev.pointerId);
      resize.removeEventListener("pointermove", move);
      resize.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(DOCK_KEY, String(width));
      } catch {
        // session-only
      }
      calendar?.updateSize();
    };
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", up);
  });

  // ---- calendar + form ------------------------------------------------------
  let calendar: ReturnType<typeof mountCalendar> | null = null;
  let form: { close: () => void } | null = null;
  const closeForm = () => {
    form = null;
    calendar?.unselect();
  };

  const draftOfEvent = (ev: CalEvent): EventDraft => ({
    title: ev.title,
    allDay: ev.allDay,
    start: ev.allDay ? dayFromInt(ev.startMs) : new Date(ev.startMs),
    end:
      ev.end === null
        ? null
        : ev.allDay
          ? dayFromInt(ev.end)
          : new Date(ev.end),
  });

  const save = async (ev: CalEvent | null, draft: EventDraft) => {
    if (ev) await updateEvent(write, ev.uuid, draft);
    else await createEvent(write, draft);
  };

  const openFormFor = (ev: CalEvent | null, draft: EventDraft | null) => {
    form?.close();
    form = openForm(panel, ev, draft, {
      onSave: (d) => save(ev, d).then(() => void calendar?.refetchEvents()),
      onDelete:
        ev
          ? (target) =>
            deleteEvent(write, target.uuid).then(() => void calendar?.refetchEvents())
          : undefined,
      onOpenInGraph: ev ? (target) => host.openBlock(target.uuid) : undefined,
      onClose: closeForm,
    });
  };

  calendar = mountCalendar(calRoot, write.dq, {
    onSlotSelect: (start, end, allDay) => {
      if (allDay && end !== null) {
        // FullCalendar's all-day select end is exclusive; the form wants the inclusive last day.
        end = new Date(end.getTime() - 86400000);
        if (end.getTime() < start.getTime()) end = null;
      }
      openFormFor(null, { title: "", allDay, start, end });
    },
    onEventClick: (ev) => openFormFor(ev, null),
    onEventMove: (ev, allDay, newStart, newEnd, revert) => {
      const draft = { ...draftOfEvent(ev), allDay, start: newStart, end: newEnd };
      save(ev, draft)
        .then(() => void calendar?.refetchEvents())
        .catch(() => revert());
    },
    onFetchError: (message) => {
      const banner = root.querySelector<HTMLElement>(".lsc-fetch-error");
      if (!banner) return;
      if (message) {
        banner.textContent = `Couldn't load events: ${message}`;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    },
  });

  // Panel header buttons
  panel.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
    if (!btn) return;
    if (btn.dataset["act"] === "close") close();
    else if (btn.dataset["act"] === "open-log") void openToday();
  });

  // Esc inside the frame closes the dock (the form handles its own Esc first via stopPropagation).
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && docked && !form) {
        e.preventDefault();
        close();
      }
    },
    true,
  );

  // ---- host wiring ----------------------------------------------------------
  host.provideModel({ [OPEN_HANDLER]: toggle });
  host.registerUIItem("toolbar", {
    key: OPEN_KEY,
    template: `<a class="button" data-on-click="${OPEN_HANDLER}" title="Calendar">${ICON}</a>`,
  });
  host.registerCommandPalette({ key: OPEN_KEY, label: "Calendar: open" }, open);

  // Live refresh: the graph changed → refetch (debounced); a graph switch refetches from scratch.
  let timer: number | undefined;
  host.onDbChanged(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      calendar?.refetchEvents();
    }, 400);
  });
  host.onGraphChanged(() => {
    calendar?.refetchEvents();
  });

  // Theme: host tokens → --lc-* vars, mode class on <html>.
  void watchTheme(theme, document).then((off) => {
    window.addEventListener("beforeunload", () => {
      try {
        off();
      } catch {
        // already gone
      }
    });
  });

  /** Opens today's daily note (resolved by journal day; a missing page is simply not opened). */
  async function openToday(): Promise<void> {
    const day = journalDayOf(new Date());
    try {
      const rows = (await write.dq(
        `[:find ?u :where [?p :block/journal-day ${day}] [?p :block/uuid ?u]]`,
      )) as Array<[string]>;
      const uuid = rows?.[0]?.[0];
      if (uuid) host.openBlock(uuid);
    } catch {
      // no journal page: nothing to open
    }
  }
}

function assertId(id: string): string {
  if (!/^[\w.-]+$/.test(id)) throw new Error(`Not a usable plugin id: ${JSON.stringify(id)}`);
  return id;
}
