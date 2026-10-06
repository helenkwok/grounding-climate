import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname);
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, "public"), dist, { recursive: true });
// The HLS scene arrays are fetched by the page, not bundled (2.3 MB of binary).
await cp(resolve(root, "../../data/external/hls-burn-scars"), resolve(dist, "data/hls-burn-scars"), { recursive: true });

// Bundled third-party code: ship each package's full licence text next to the page (MIT requires it).
const bundledLicences = ["@noble/post-quantum", "@noble/hashes", "@noble/curves"];
const licenceTexts = await Promise.all(
  bundledLicences.map(async (name) =>
    "== " + name + " ==\n\n" + (await readFile(resolve(root, "../../node_modules", name, "LICENSE"), "utf8")),
  ),
);
await writeFile(resolve(dist, "third-party-licenses.txt"), licenceTexts.join("\n"));

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
