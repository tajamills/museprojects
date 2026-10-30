// Builds the React client to dist/client/ with esbuild (node).
// Replaces the original bun ./client/build.mjs, which delegated to the
// proprietary @hatch/space-sdk build pipeline.
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url)); // client/
const repoRoot = path.dirname(root);
const outdir = path.join(repoRoot, "dist", "client");

await mkdir(outdir, { recursive: true });

// Holding switch (src/site.ts): while SITE_HIDDEN is true, bundle the
// holding entry (src/main-holding.tsx) instead of the product app, so
// the shipped client renders only the holding page on every route.
// Flip the flag in site.ts to restore the full app.
const siteSource = await readFile(path.join(root, "src/site.ts"), "utf8");
const siteHidden = /export const SITE_HIDDEN = true/.test(siteSource);
const entryPoint = siteHidden ? "src/main-holding.tsx" : "src/main.tsx";
console.log(`[build:client] SITE_HIDDEN=${siteHidden} — entry: ${entryPoint}`);

await build({
  entryPoints: [path.join(root, entryPoint)],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["chrome110", "firefox110", "safari16"],
  format: "esm",
  outfile: path.join(outdir, "bundle.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  jsx: "automatic",
  logLevel: "info",
  // theme.css is compiled separately by the Tailwind CLI and linked from
  // index.html; the JS bundle must not try to inline it.
  plugins: [
    {
      name: "drop-css-imports",
      setup(b) {
        b.onResolve({ filter: /\.css$/ }, () => ({ path: "__css__", namespace: "css-stub", external: false }));
        b.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({ contents: "export default {};", loader: "js" }));
      },
    },
  ],
});

// Tailwind v4 CLI compiles theme.css (resolves @import "tailwindcss").
await run(path.join(repoRoot, "node_modules", ".bin", "tailwindcss"), [
  "-i", path.join(root, "src", "theme.css"),
  "-o", path.join(outdir, "theme.css"),
  "--minify",
]);

await cp(path.join(root, "index.html"), path.join(outdir, "index.html"));
await cp(path.join(root, "logo.png"), path.join(outdir, "logo.png"));
await cp(path.join(root, "logo-mark.png"), path.join(outdir, "logo-mark.png"));
await cp(path.join(root, "facebook-setup-tutorial.mp4"), path.join(outdir, "facebook-setup-tutorial.mp4"));
await cp(path.join(root, "getting-started-tutorial.mp4"), path.join(outdir, "getting-started-tutorial.mp4"));
await cp(path.join(root, "getting-started-poster.png"), path.join(outdir, "getting-started-poster.png"));
await cp(path.join(root, "google19638b72474d3670.html"), path.join(outdir, "google19638b72474d3670.html"));
await cp(path.join(root, "sitemap.xml"), path.join(outdir, "sitemap.xml"));
await cp(path.join(root, "robots.txt"), path.join(outdir, "robots.txt"));
// Black Friday captions-pack PDF, served under an unguessable path
// segment; the path is only handed out by the server after a Stripe
// read-back verifies payment (see BF_PACK_DOWNLOAD_PATH in
// server/src/billing.ts — keep the two in sync).
await cp(path.join(root, "bf-pack-f111d5619e2e249b"), path.join(outdir, "bf-pack-f111d5619e2e249b"), { recursive: true });
console.log("[build:client] dist/client ready");
