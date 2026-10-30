import { defineConfig, type Plugin } from "vite";

/** Built plugin page CSP: its own scripts and styles only, no network (logseq-planner's proven policy). */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

/** Third-party attribution travels with the bundle (minify strips upstream license comments). */
const BANNER = [
  "/*! logseq-calendar | MIT License | https://github.com/hy-sde/logseq-calendar */",
  "/*! Bundles FullCalendar (https://github.com/fullcalendar/fullcalendar) —",
  " *  MIT License, Copyright (c) 2021 Adam Shaw. Full license text: see the LICENSE",
  " *  file at the repository above. */",
].join("\n");

const csp = (): Plugin => ({
  name: "calendar-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<title>", `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<title>`),
  generateBundle: (_, bundle) => {
    for (const file of Object.values(bundle)) {
      if (file.type === "chunk") file.code = `${BANNER}\n${file.code}`;
    }
  },
});

export default defineConfig({
  base: "./",
  publicDir: false, // icon.svg stays at the repo root and travels with package.json into the install dir
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [csp()],
});
