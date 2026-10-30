import { defineConfig, type Plugin } from "vite";

/** Built plugin page CSP: its own scripts and styles only, no network (logseq-planner's proven policy). */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

const csp = (): Plugin => ({
  name: "calendar-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<title>", `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<title>`),
});

export default defineConfig({
  base: "./",
  publicDir: false, // icon.svg stays at the repo root and travels with package.json into the install dir
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [csp()],
});
