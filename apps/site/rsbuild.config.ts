import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";

export default defineConfig({
  // A GitHub Pages project site lives under /<repo>/: build it with SITE_BASE=/grounding.
  server: { port: 4180, host: "127.0.0.1", base: process.env.SITE_BASE ?? "/" },
  output: {
    copy: [
      // MapLibre's worker is a module that imports the shared chunk from beside itself.
      { from: "../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", to: "maplibre" },
      { from: "../../node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", to: "maplibre" },
      // The HLS scene arrays (2.3 MB of binary) are fetched by the earth claim, not bundled.
      { from: "../../data/external/hls-burn-scars", to: "data/hls-burn-scars" },
    ],
  },
  plugins: [pluginReact(), tanstackStart({ prerender: { enabled: true, crawlLinks: true } })],
  tools: {
    rspack: {
      module: {
        rules: [
          // The committed BDG2 and registry files are checked against recorded digests, so they arrive as exact text.
          { test: /\.csv$/, type: "asset/source" },
          { test: /data[\\/]external[\\/]bdg2[\\/].*\.json$/, type: "asset/source" },
        ],
      },
    },
  },
});
