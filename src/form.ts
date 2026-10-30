/** The event editor: a modal form over the calendar. */
import { dayFromInt } from "./calendar";
import type { CalEvent, EventDraft } from "./types";

export interface FormHooks {
  onSave: (draft: EventDraft) => Promise<void>;
  onDelete?: (ev: CalEvent) => Promise<void>;
  onOpenInGraph?: (ev: CalEvent) => void;
  onClose: () => void;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const dateValue = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (day: string, time: string): Date => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
};
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface FormHandle {
  close: () => void;
}

/** Opens the form. `event` present = edit mode; else create mode with `draft` prefilled. */
export function openForm(
  root: HTMLElement,
  event: CalEvent | null,
  draft: EventDraft | null,
  hooks: FormHooks,
): FormHandle {
  const ev = event;
  const allDay = ev ? ev.allDay : (draft?.allDay ?? false);
  const start = ev
    ? ev.allDay
      ? dayFromInt(ev.startMs)
      : new Date(ev.startMs)
    : (draft?.start ?? new Date());
  const end = ev
    ? ev.end !== null
      ? ev.allDay
        ? dayFromInt(ev.end)
        : new Date(ev.end)
      : null
    : (draft?.end ?? null);

  const overlay = document.createElement("div");
  overlay.className = "lsc-overlay";
  overlay.innerHTML = `
    <div class="lsc-form" role="dialog" aria-label="${ev ? "Edit event" : "New event"}">
      <div class="lsc-form-title">${ev ? "Edit event" : "New event"}</div>
      <input class="lsc-input lsc-title" type="text" placeholder="Title" value="${esc(ev ? ev.title : (draft?.title ?? ""))}" maxlength="500">
      <label class="lsc-check"><input type="checkbox" class="lsc-allday" ${allDay ? "checked" : ""}> All day</label>
      <div class="lsc-grid">
        <label>Starts</label>
        <input class="lsc-input lsc-start-day" type="date" value="${dateValue(start)}">
        <input class="lsc-input lsc-start-time" type="time" value="${timeValue(start)}" step="300">
        <label>Ends</label>
        <input class="lsc-input lsc-end-day" type="date" value="${end ? dateValue(end) : ""}">
        <input class="lsc-input lsc-end-time" type="time" value="${end && !allDay ? timeValue(end) : ""}" step="300">
      </div>
      <div class="lsc-form-actions">
        <span class="lsc-form-links">
          ${ev && hooks.onOpenInGraph ? '<button class="lsc-link" data-act="open">open in graph</button>' : ""}
          ${ev && hooks.onDelete ? '<button class="lsc-link lsc-danger" data-act="delete">delete</button>' : ""}
        </span>
        <button class="lsc-btn" data-act="cancel">Cancel</button>
        <button class="lsc-btn lsc-primary" data-act="save">${ev ? "Save" : "Add"}</button>
      </div>
      <div class="lsc-form-error" hidden></div>
    </div>`;
  root.appendChild(overlay);

  const q = <T extends HTMLElement>(sel: string): T => overlay.querySelector<T>(sel)!;
  const titleEl = q<HTMLInputElement>(".lsc-title");
  const allDayEl = q<HTMLInputElement>(".lsc-allday");
  const startDayEl = q<HTMLInputElement>(".lsc-start-day");
  const startTimeEl = q<HTMLInputElement>(".lsc-start-time");
  const endDayEl = q<HTMLInputElement>(".lsc-end-day");
  const endTimeEl = q<HTMLInputElement>(".lsc-end-time");
  const errorEl = q<HTMLElement>(".lsc-form-error");
  titleEl.focus();
  titleEl.select();

  const syncAllDay = () => {
    const allDayNow = allDayEl.checked;
    startTimeEl.hidden = allDayNow;
    endTimeEl.hidden = allDayNow;
    endDayEl.hidden = false;
  };
  allDayEl.addEventListener("change", syncAllDay);
  syncAllDay();

  const show = (msg: string) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };

  const collect = (): EventDraft | null => {
    const title = titleEl.value.trim();
    if (!title) {
      show("The event needs a title.");
      return null;
    }
    if (!startDayEl.value) {
      show("The event needs a start day.");
      return null;
    }
    const allDayNow = allDayEl.checked;
    const start = at(startDayEl.value, allDayNow ? "00:00" : startTimeEl.value || "09:00");
    const endDay = endDayEl.value;
    if (allDayNow) {
      const end = endDay ? at(endDay, "00:00") : null;
      if (end && end.getTime() < start.getTime()) {
        show("The end day is before the start day.");
        return null;
      }
      return { title, allDay: true, start, end };
    }
    const end = endDay ? at(endDay, endTimeEl.value || "10:00") : null;
    return { title, allDay: false, start, end };
  };

  const close = () => {
    overlay.remove();
    hooks.onClose();
  };

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.target as HTMLElement)?.classList?.contains("lsc-title")) {
      e.preventDefault();
      void save();
    }
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  const save = async () => {
    const d = collect();
    if (!d) return;
    for (const btn of overlay.querySelectorAll<HTMLButtonElement>("button")) btn.disabled = true;
    try {
      await hooks.onSave(d);
      close();
    } catch (err) {
      show(err instanceof Error ? err.message : String(err));
      for (const btn of overlay.querySelectorAll<HTMLButtonElement>("button")) btn.disabled = false;
    }
  };

  overlay.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const act = btn.dataset["act"];
    if (act === "cancel") close();
    else if (act === "save") void save();
    else if (act === "delete" && ev && hooks.onDelete) {
      btn.disabled = true;
      hooks
        .onDelete(ev)
        .then(close)
        .catch((err) => show(err instanceof Error ? err.message : String(err)))
        .finally(() => (btn.disabled = false));
    } else if (act === "open" && ev && hooks.onOpenInGraph) hooks.onOpenInGraph(ev);
  });

  return { close };
}
