/** The FullCalendar instance: views, drag & drop, event fetching. */
import { Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventClickArg, EventDropArg } from "@fullcalendar/core";
import { fetchEvents } from "./query";
import type { CalEvent } from "./types";

const VIEW_KEY = "logseq-calendar.view";
const DATE_KEY = "logseq-calendar.date";

export interface CalendarHooks {
  /** A click on an empty slot / a drag over empty slots: open the form with the range prefilled. */
  onSlotSelect: (start: Date, end: Date | null, allDay: boolean) => void;
  /** A click on an event: open the form in edit mode. */
  onEventClick: (ev: CalEvent) => void;
  /** A drag or a resize moved an event; persist, or revert on failure. `allDay` is the post-drag state. */
  onEventMove: (ev: CalEvent, allDay: boolean, newStart: Date, newEnd: Date | null, revert: () => void) => void;
  /** The event query failed; the panel shows the message (cleared on the next successful fetch). */
  onFetchError: (message: string) => void;
}

/** The stored view/date, kept per plugin across sessions. */
function restoreState(): { view: string; date: Date | undefined } {
  let view = "timeGridWeek";
  let date: Date | undefined;
  try {
    view = localStorage.getItem(VIEW_KEY) ?? view;
    const raw = localStorage.getItem(DATE_KEY);
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) date = d;
    }
  } catch {
    // private mode: defaults hold
  }
  return { view, date };
}

function keepState(view: string, date: Date): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
    localStorage.setItem(DATE_KEY, date.toISOString());
  } catch {
    // ignore
  }
}

/** Mounts the calendar into `root` and returns it. */
export function mountCalendar(
  root: HTMLElement,
  dq: (query: string, ...inputs: unknown[]) => Promise<unknown>,
  hooks: CalendarHooks,
): Calendar {
  const { view, date } = restoreState();
  const toEvent = (ev: CalEvent) => {
    const end: Date | undefined =
      ev.end === null
        ? undefined
        : ev.allDay
          ? new Date(dayFromInt(ev.end!).getTime() + 86400000) // FullCalendar's end is exclusive
          : new Date(ev.end);
    return {
      id: ev.uuid,
      title: ev.title,
      allDay: ev.allDay,
      start: ev.allDay ? dayFromInt(ev.startMs) : new Date(ev.startMs),
      end,
      extendedProps: { ev },
      classNames: ev.done ? ["lsc-done"] : [],
    };
  };

  const calendar = new Calendar(root, {
    plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
    initialView: view,
    initialDate: date,
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
    },
    buttonText: { today: "today", month: "month", week: "week", day: "day", list: "list" },
    height: "100%",
    expandRows: true,
    nowIndicator: true,
    scrollTime: "08:00:00",
    selectable: true,
    selectMirror: true,
    unselectAuto: true,
    editable: true,
    eventStartEditable: true,
    eventDurationEditable: true,
    dayMaxEventRows: true,
    events: (info, success, failure) => {
      fetchEvents(dq, info.start, info.end)
        .then((evs) => {
          hooks.onFetchError("");
          success(evs.map(toEvent));
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          console.error("[logseq-calendar] event query failed:", e);
          hooks.onFetchError(message);
          failure(e instanceof Error ? e : new Error(message));
        });
    },
    datesSet: (arg) => keepState(arg.view.type, arg.view.currentStart),
    dateClick: (arg: DateClickArg) => {
      if (arg.view.type === "dayGridMonth" || arg.view.type === "listWeek") {
        hooks.onSlotSelect(arg.date, null, true);
      } else {
        hooks.onSlotSelect(arg.date, null, false);
      }
    },
    select: (arg) => hooks.onSlotSelect(arg.start, arg.end ?? null, arg.allDay),
    eventClick: (arg: EventClickArg) => {
      const ev = arg.event.extendedProps["ev"] as CalEvent | undefined;
      if (ev) {
        arg.jsEvent.preventDefault();
        hooks.onEventClick(ev);
      }
    },
    eventDrop: (arg: EventDropArg) => {
      const ev = arg.event.extendedProps["ev"] as CalEvent | undefined;
      if (!ev) return;
      hooks.onEventMove(ev, arg.event.allDay, arg.event.start ?? arg.oldEvent.start!, arg.event.end ?? null, () =>
        arg.revert());
    },
    eventResize: (arg) => {
      const ev = arg.event.extendedProps["ev"] as CalEvent | undefined;
      if (!ev) return;
      hooks.onEventMove(ev, arg.event.allDay, arg.event.start ?? arg.oldEvent.start!, arg.event.end, () => arg.revert());
    },
  });
  calendar.render();
  return calendar;
}

/** The local midnight Date of a journal-day int. */
export function dayFromInt(day: number): Date {
  return new Date(Math.floor(day / 10000), Math.floor((day % 10000) / 100) - 1, day % 100);
}
