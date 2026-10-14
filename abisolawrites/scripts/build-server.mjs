// Bundles the Express server to a single dist/server.js with esbuild (node).
import { build } from "esbuild";
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

console.log("[build:server] dist/server.js ready");
