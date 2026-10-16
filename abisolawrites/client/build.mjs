// Builds the React client to dist/client/ with esbuild (node).
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url)); // client/
const repoRoot = path.dirname(root);
const outdir = path.join(repoRoot, "dist", "client");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/main.tsx")],
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
await cp(path.join(root, "favicon.svg"), path.join(outdir, "favicon.svg"));
await cp(path.join(root, "google19638b72474d3670.html"), path.join(outdir, "google19638b72474d3670.html"));
console.log("[build:client] dist/client ready");
