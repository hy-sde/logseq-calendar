/**
 * Maps the host theme's tokens onto the plugin's `--lc-*` variables and keeps the dark class in
 * step (the approach of logseq-planner's theme watch, proven on the desktop app).
 */
import type { ThemeDeps } from "./types";

/** Appended after a host font family: the host's webfonts do not load inside the frame. */
export const FONT_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const GENERIC_FONT = /(^|,)\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)\s*$/;

/** `--lc-*` token → host tokens, first that resolves wins. */
const LC_MAP: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["--lc-bg", ["--ls-primary-background-color"]],
  ["--lc-bg-2", ["--ls-secondary-background-color"]],
  ["--lc-text", ["--ls-primary-text-color"]],
  ["--lc-text-2", ["--ls-secondary-text-color"]],
  ["--lc-border", ["--ls-border-color"]],
  ["--lc-accent", ["--ls-active-primary-color"]],
  ["--lc-font", ["--ls-font-family"]],
];

const TOKENS = LC_MAP.flatMap(([, sources]) => sources);

const resolved = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** Parses a resolved colour to rgb channels; null when unparseable (hsl triples etc.). */
function rgb(v: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v);
  if (r) return [Number(r[1]), Number(r[2]), Number(r[3])];
  return null;
}

/** White or near-black text, whichever reads better on `bg`. */
function contrastOn(v: string): string {
  const c = rgb(v);
  if (!c) return "#ffffff";
  const luma = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return luma > 0.55 ? "#1a1a1c" : "#ffffff";
}

const RERESOLVE_DELAYS_MS = [250, 1000];

/** Applies host mode + tokens now, and again on every mode or theme change. Resolves the unsubscribe. */
export async function watchTheme(deps: ThemeDeps, doc: Document): Promise<() => void> {
  const root = doc.documentElement;
  let latest = 0;
  const applyTokens = async () => {
    const call = ++latest;
    const vals = (await deps.resolveThemeCssPropsVals(TOKENS)) ?? {};
    if (call !== latest) return; // a newer resolve owns the result
    for (const [name] of LC_MAP) root.style.removeProperty(name);
    for (const [name, sources] of LC_MAP) {
      const src = sources.find((s) => resolved(vals[s]));
      if (!src) continue;
      const v = vals[src]!.trim();
      if (name === "--lc-font" && !GENERIC_FONT.test(v)) {
        root.style.setProperty(name, `${v}, ${FONT_FALLBACK}`);
      } else {
        root.style.setProperty(name, v);
      }
    }
    // The event chip paints the accent; its text follows the accent's luma.
    const accent = root.style.getPropertyValue("--lc-accent");
    if (accent) {
      root.style.setProperty("--lc-event-text", contrastOn(accent));
    }
  };
  const applyMode = (mode: string | undefined) => root.classList.toggle("dark", mode === "dark");

  const applyTokensAgain = () => {
    void applyTokens();
    for (const ms of RERESOLVE_DELAYS_MS) deps.later(() => void applyTokens(), ms);
  };
  const offs = [
    deps.onThemeModeChanged(({ mode }) => {
      applyMode(mode);
      applyTokensAgain();
    }),
    deps.onThemeChanged(applyTokensAgain),
  ];
  const off = () => offs.forEach((f) => {
    try {
      (f as { unsubscribe?: () => void })?.unsubscribe?.();
    } catch {
      // already gone
    }
  });
  try {
    applyMode((await deps.getUserConfigs())?.preferredThemeMode);
  } catch {
    // mode stays at the stylesheet default
  }
  await applyTokens();
  return off;
}
