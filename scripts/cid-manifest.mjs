// Lists every committed evidence file and signed record with its SHA-256 and IPFS content address (CIDv1, raw,
// sha2-256), computed offline. `--check` recomputes it and fails if reports/cid-manifest.json is out of date.
// A file over 1 MiB would not be a single IPFS block, so its CID would not equal its SHA-256: flagged, not hidden.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";

import { cidFromSha256 } from "@grounding-climate/core";

const root = new URL("../", import.meta.url);
const OUTPUT = "reports/cid-manifest.json";
const BLOCK_LIMIT = 1024 * 1024;

const walk = async (dir) =>
  (await readdir(new URL(dir, root), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => (entry.parentPath + "/" + entry.name).slice(new URL(".", root).pathname.length));

const paths = [
  ...(await walk("data/external")),
  ...(await walk("reports")).filter((path) => path.endsWith(".json") && path !== OUTPUT),
  "sources/rights-manifest.json",
].sort();

const files = [];
for (const path of paths) {
  const bytes = await readFile(new URL(path, root));
  const sha256 = "SHA-256:" + createHash("sha256").update(bytes).digest("base64url");
  files.push({ path, bytes: bytes.length, sha256, cid: cidFromSha256(sha256), singleBlock: bytes.length <= BLOCK_LIMIT });
}

const manifest = {
  schemaVersion: "grounding.cid-manifest/0.1",
  cid: "CIDv1, raw codec (0x55), sha2-256 multihash, base32. Equals the file's SHA-256 while the file is one block.",
  publishWith: "ipfs add --cid-version=1 --chunker=size-1048576",
  files,
};
const text = JSON.stringify(manifest, null, 2) + "\n";
const multiBlock = files.filter((file) => !file.singleBlock).map((file) => file.path);

if (process.argv.includes("--check")) {
  const committed = await readFile(new URL(OUTPUT, root), "utf8").catch(() => "");
  if (committed !== text) {
    console.error(OUTPUT + " is out of date. Run: node scripts/cid-manifest.mjs");
    process.exit(1);
  }
  console.log("CID manifest matches " + files.length + " files" + (multiBlock.length ? "; multi-block: " + multiBlock.join(", ") : "; all single-block."));
} else {
  await writeFile(new URL(OUTPUT, root), text);
  console.log("Wrote " + OUTPUT + " (" + files.length + " files" + (multiBlock.length ? "; multi-block: " + multiBlock.join(", ") : "") + ").");
}
