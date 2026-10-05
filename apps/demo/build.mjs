import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname);
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, "public"), dist, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/main.ts")],
  outfile: resolve(dist, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  // The prepared BDG2 files are checked against their recorded digests, so they arrive as exact text.
  loader: { ".csv": "text" },
  plugins: [
    {
      name: "bdg2-json-as-text",
      setup(context) {
        context.onLoad({ filter: /data[\\/]external[\\/]bdg2[\\/].*\.json$/ }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
      },
    },
  ],
  logLevel: "info",
});
