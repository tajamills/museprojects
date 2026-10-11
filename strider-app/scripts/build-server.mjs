// Bundles the Express server to a single dist/server.js with esbuild (node).
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // repo root
const dist = path.join(root, "dist");

await build({
  entryPoints: [path.join(root, "server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm", // package.json has "type": "module", so dist/server.js runs as ESM
  outfile: path.join(dist, "server.js"),
  sourcemap: true,
  logLevel: "info",
  // Bundled CJS deps (e.g. express's `depd`) call require("path") etc. at
  // module load; in ESM output there is no global require, so provide one.
  banner: {
    js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);`,
  },
});

await mkdir(path.join(dist, "migrations"), { recursive: true });
await cp(path.join(root, "server/migrations"), path.join(dist, "migrations"), { recursive: true });
console.log("[build:server] dist/server.js + dist/migrations ready");
