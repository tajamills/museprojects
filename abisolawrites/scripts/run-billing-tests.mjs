// Bundles tests/billing-harness.ts and runs it against a throwaway file
// store. Usage: node scripts/run-billing-tests.mjs
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const work = await mkdtemp(path.join(tmpdir(), "abisola-billing-tests-"));
const outfile = path.join(work, "harness.mjs");

await build({
  entryPoints: [path.join(root, "tests/billing-harness.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile,
  banner: {
    js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);`,
  },
});

const code = await new Promise((resolve) => {
  execFile(process.execPath, [outfile], {
    env: { ...process.env, DATA_FILE: path.join(work, "store.json") },
  }, (err, stdout, stderr) => {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    resolve(err ? (typeof err.code === "number" ? err.code : 1) : 0);
  });
});
process.exit(code);
