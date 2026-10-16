// kovala client bundle (Node, no Bun).
//
// Replaces the TS-space's `client/build.mjs`, which delegated to
// `@hatch/space-sdk/build`'s Bun.build() pipeline. This does the equivalent
// with plain tools:
//
//   1. Tailwind v4 CLI compiles client/src/theme.css → dist/assets/theme.css
//   2. esbuild bundles client/src/main.tsx → dist/assets/main-<hash>.js
//      (production mode: minified, NODE_ENV=production)
//   3. dist/index.html is generated linking both.
//
// Output: <repo>/dist/client/ (served by Express). Run from the repo root:
//   npm run build:client

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path, { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // client/
const repoRoot = dirname(here);
const outDir = path.join(repoRoot, "dist", "client");
const assetsDir = path.join(outDir, "assets");

await rm(outDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

// 1. Tailwind CSS (v4 CLI). theme.css starts with `@import "tailwindcss";`
//    and `@import "tailwindcss-safe-area";` — the CLI resolves both from
//    node_modules.
const tw = spawnSync(
  "npx",
  [
    "tailwindcss",
    "--input",
    path.join(here, "src", "theme.css"),
    "--output",
    path.join(assetsDir, "theme.css"),
    "--minify",
  ],
  { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" },
);
if (tw.status !== 0) {
  throw new Error("tailwindcss build failed");
}

// 2. JS/TSX bundle via esbuild. Note: main.tsx intentionally does NOT import
//    theme.css (esbuild can't run the Tailwind compiler); the generated
//    index.html links dist/assets/theme.css instead.
const result = await build({
  entryPoints: [path.join(here, "src", "main.tsx")],
  outdir: assetsDir,
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110", "firefox110", "safari16"],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  entryNames: "[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  loader: { ".css": "css" },
  metafile: true,
  logLevel: "info",
});

const jsFile = basename(
  Object.keys(result.metafile.outputs).find((f) => f.endsWith(".js")) ?? "",
);
if (!jsFile) throw new Error("esbuild produced no JS output");

// 3. index.html
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="color-scheme" content="light dark" />
    <meta name="google-site-verification" content="RhXLG-gGaXkby9VKo9wEWdS4y_6XAMkEBuRwI50LwyU" />
    <link rel="icon" type="image/svg+xml" href="./brand-mark.svg" />
    <title>kovala — business entity manager & compliance reminders</title>
    <meta name="description" content="kovala — the business entity manager. Track LLCs and corporations, keep documents in a secure vault, and never miss a compliance deadline or annual filing." />
    <meta property="og:title" content="kovala — business entity manager & compliance reminders" />
    <meta property="og:description" content="Track LLCs and corporations, keep documents in a secure vault, and never miss a compliance deadline or annual filing." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://kovala.io/" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="kovala — business entity manager & compliance reminders" />
    <meta name="twitter:description" content="Track LLCs and corporations, keep documents in a secure vault, and never miss a compliance deadline or annual filing." />
    <link rel="stylesheet" href="./assets/theme.css" />
    <script type="module" src="./assets/${jsFile}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
await writeFile(path.join(outDir, "index.html"), html);
await cp(path.join(here, "logo.png"), path.join(outDir, "logo.png"));
await cp(path.join(here, "logo-mark.png"), path.join(outDir, "logo-mark.png"));
await cp(path.join(here, "brand-mark.svg"), path.join(outDir, "brand-mark.svg"));
await cp(path.join(here, "google19638b72474d3670.html"), path.join(outDir, "google19638b72474d3670.html"));

console.log(`Client bundle written to ${outDir}`);
