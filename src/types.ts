/** Shared types. */

/** A CSS style keyed by camelCase properties (set on the main-UI container). */
export type Frame = Record<string, string>;

/** One event, normalized from the graph. Times are epoch ms; all-day uses local day ints. */
export interface CalEvent {
  uuid: string;
  title: string;
  allDay: boolean;
  startMs: number;
  /** Inclusive end (ms for timed, last day int for all-day); null when open-ended. */
  end: number | null;
  done: boolean;
  /** Page the block lives on: journal day int, or null for a non-journal home. */
  journalDay: number | null;
  pageName: string | null;
}

/** What the form collects and the write path consumes. */
export interface EventDraft {
  title: string;
  allDay: boolean;
  /** Local Date for the start (all-day: the date only matters). */
  start: Date;
  /** Local Date for the end; null = none. All-day end is inclusive (the last day). */
  end: Date | null;
}

export interface WriteDeps {
  dq: (query: string, ...inputs: unknown[]) => Promise<unknown>;
  createJournalPage: (date: string) => Promise<unknown>;
  appendBlock: (pageUuid: string, content: string) => Promise<string | null>;
  updateBlock: (uuid: string, content: string) => Promise<unknown>;
  removeBlock: (uuid: string) => Promise<unknown>;
  upsertBlockProperty: (uuid: string, key: string, value: number) => Promise<unknown>;
  removeBlockProperty: (uuid: string, key: string) => Promise<unknown>;
}

export interface ThemeDeps {
  later: (fn: () => void, ms: number) => void;
  getUserConfigs: () => Promise<{ preferredThemeMode?: string } | null>;
  resolveThemeCssPropsVals: (names: string[]) => Promise<Record<string, string | undefined> | null>;
  onThemeModeChanged: (cb: (e: { mode: string }) => void) => unknown;
  onThemeChanged: (cb: () => void) => unknown;
}

export interface HostDeps {
  pluginId: () => string;
  registerUIItem: (type: "toolbar", item: { key: string; template: string }) => unknown;
  registerCommandPalette: (command: { key: string; label: string }, action: () => void) => unknown;
  provideModel: (model: Record<string, unknown>) => unknown;
  provideStyle: (style: { key: string; style: string }) => unknown;
  showMainUI: () => unknown;
  hideMainUI: () => unknown;
  setMainUIInlineStyle: (style: Frame) => unknown;
  openBlock: (uuid: string) => void;
  onDbChanged: (cb: () => void) => unknown;
  onGraphChanged: (cb: () => void) => unknown;
  setContainerStyle: (style: Frame) => void;
  hostWindow: () => Window | null;
}
