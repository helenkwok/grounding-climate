// Loads the committed HLS scene arrays (data/external/hls-burn-scars/<scene>) and checks each file's SHA-256
// against its manifest before use.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function loadHlsScene(sceneId) {
  const dir = new URL("../../data/external/hls-burn-scars/" + sceneId + "/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", dir), "utf8"));
  const read = async (name) => {
    const bytes = await readFile(new URL(name, dir));
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.files[name].sha256) {
      throw new Error(name + " does not match its manifest SHA-256");
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  return {
    manifest,
    scene: {
      sceneId,
      width: manifest.width,
      height: manifest.height,
      pixelSizeMeters: manifest.pixelSizeMeters,
      nir: new Float32Array(await read("nir.f32")),
      swir2: new Float32Array(await read("swir2.f32")),
      mask: new Int8Array(await read("mask.i8")),
      acquiredAt: "2018-07-09",
      geography: "HLS tile T10SEH, northern California",
    },
  };
}
