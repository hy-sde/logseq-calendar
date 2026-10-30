/** The single SDK boundary: every `logseq.*` call lives here (the rest of the code takes deps). */
import "@logseq/libs";
import type { Frame, HostDeps, ThemeDeps, WriteDeps } from "./types";

/** The host header's height; the dock starts under it. */
export const HEADBAR = "var(--ls-headbar-height, 3rem)";

/** The plugin id goes into an attribute selector: letters, digits, dot, underscore, hyphen only. */
export function assertPluginId(id: string): string {
  if (!/^[\w.-]+$/.test(id)) throw new Error(`Not a usable plugin id: ${JSON.stringify(id)}`);
  return id;
}

/** The docked frame's style: fixed to the right edge, under the header, full height. */
export const dockFrame = (width: number, top: string): Frame => ({
  position: "fixed",
  zIndex: "999",
  top,
  left: "auto",
  right: "0",
  width: `${width}px`,
  height: `calc(100vh - ${top})`,
});

/**
 * Host CSS that makes room for the docked frame: the app wrapper gets `margin-right` while the
 * plugin's container is visible (the Outline-Canvas "mirror" approach, proven by logseq-planner).
 */
export function dockHostStyle(pluginId: string, width: number): string {
  assertPluginId(pluginId);
  return `body:has(.lsp-iframe-sandbox-container.visible[data-pid="${pluginId}"]) #app-container-wrapper {\n`
    + `  margin-right: ${width}px !important;\n  transition: margin-right 0.2s ease;\n}`;
}

/**
 * Styles the main-UI container directly: a persisted host layout makes the host drop position/size
 * keys from `setMainUIInlineStyle`, so when the frame is same-origin (desktop) we style the container
 * ourselves; cross-origin (dev server) falls back to `setMainUIInlineStyle`.
 */
export function setContainerStyle(style: Frame): void {
  let el: HTMLElement | null = null;
  try {
    el = parent.document.querySelector<HTMLElement>(
      `.lsp-iframe-sandbox-container[data-pid="${assertPluginId(logseq.baseInfo.id)}"]`,
    );
  } catch {
    // cross-origin: parent.document is not readable
  }
  if (!el) return void logseq.setMainUIInlineStyle(style as never);
  delete el.dataset.inited_layout;
  for (const [k, v] of Object.entries(style)) {
    el.style.setProperty(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v, "important");
  }
}

/** The host document, or null when the frame is cross-origin (reading `parent.document` throws). */
export function hostDocument(): Document | null {
  try {
    return parent.document.defaultView ? parent.document : null;
  } catch {
    return null;
  }
}

/** The real SDK behind `registerApp`. */
export const appDeps = (): { host: HostDeps; write: WriteDeps; theme: ThemeDeps } => ({
  host: {
    pluginId: () => logseq.baseInfo.id,
    registerUIItem: (type, item) => logseq.App.registerUIItem(type, item),
    registerCommandPalette: (command, action) => logseq.App.registerCommandPalette(command, action),
    provideModel: (model) => logseq.provideModel(model),
    provideStyle: (style) => void logseq.provideStyle(style as never),
    showMainUI: () => logseq.showMainUI({ autoFocus: true }),
    hideMainUI: () => logseq.hideMainUI({ restoreEditingCursor: true }),
    setMainUIInlineStyle: (style) => void logseq.setMainUIInlineStyle(style as never),
    openBlock: (uuid) => logseq.App.pushState("page", { name: uuid }),
    onDbChanged: (cb) => logseq.DB.onChanged(() => cb()),
    onGraphChanged: (cb) => logseq.App.onCurrentGraphChanged(() => cb()),
    setContainerStyle,
    hostWindow: () => hostDocument()?.defaultView ?? null,
  },
  write: {
    dq: (query, ...inputs) => logseq.DB.datascriptQuery(query, ...inputs) as never,
    createJournalPage: (date) => logseq.Editor.createJournalPage(date),
    appendBlock: async (pageUuid, content) => (await logseq.Editor.appendBlockInPage(pageUuid, content))?.uuid ?? null,
    updateBlock: (uuid, content) => logseq.Editor.updateBlock(uuid, content),
    removeBlock: (uuid) => logseq.Editor.removeBlock(uuid),
    upsertBlockProperty: (uuid, key, value) => logseq.Editor.upsertBlockProperty(uuid, key, value),
    removeBlockProperty: (uuid, key) => logseq.Editor.removeBlockProperty(uuid, key),
  },
  theme: {
    later: (fn, ms) => void setTimeout(fn, ms),
    getUserConfigs: () => logseq.App.getUserConfigs(),
    resolveThemeCssPropsVals: (names) => logseq.UI.resolveThemeCssPropsVals(names),
    onThemeModeChanged: (cb) => logseq.App.onThemeModeChanged(cb),
    onThemeChanged: (cb) => logseq.App.onThemeChanged(cb),
  },
});
