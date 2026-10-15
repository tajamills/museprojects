// Client bundle for the standalone Node build (no bun, no @hatch/space-sdk).
//
// 1. esbuild bundles client/src/main.tsx -> client/dist/assets/index.js
// 2. the Tailwind v4 CLI compiles client/src/theme.css -> client/dist/assets/index.css
//    (theme.css is NOT imported by main.tsx; esbuild alone cannot expand the
//    `@import "tailwindcss"` directives, so CSS goes through the CLI)
// 3. client/index.html is copied to client/dist/index.html
//
// The Express server serves client/dist/ statically.

import { build } from "esbuild";
import { execFile } from "node:child_process";
import { existsSync, cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)); // client/
const outdir = path.join(root, "dist");
const assetsDir = path.join(outdir, "assets");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "main.tsx")],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(assetsDir, "index.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

function findTailwindBin() {
  const local = path.join(root, "..", "node_modules", ".bin", "tailwindcss");
  if (existsSync(local)) return local;
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

const tailwindBin = findTailwindBin();
const tailwindArgs =
  tailwindBin.endsWith("npx") || tailwindBin.endsWith("npx.cmd")
    ? ["--yes", "tailwindcss", "-i"]
    : ["-i"];

await new Promise((resolve, reject) => {
  execFile(
    tailwindBin,
    [
      ...tailwindArgs,
      path.join(root, "src", "theme.css"),
      "-o",
      path.join(assetsDir, "index.css"),
      "--minify",
    ],
    { cwd: path.join(root, "..") },
    (err, _stdout, stderr) => {
      if (err) reject(new Error(`tailwindcss failed: ${stderr || err.message}`));
      else resolve(undefined);
    },
  );
});

cpSync(path.join(root, "index.html"), path.join(outdir, "index.html"));
cpSync(path.join(root, "favicon.svg"), path.join(outdir, "favicon.svg"));
cpSync(path.join(root, "robots.txt"), path.join(outdir, "robots.txt"));
cpSync(path.join(root, "sitemap.xml"), path.join(outdir, "sitemap.xml"));
console.log("client build complete ->", outdir);
