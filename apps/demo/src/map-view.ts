// Where the cases are: the building site and the earth scene footprint, from their committed evidence, on
// OpenFreeMap vector tiles drawn by MapLibre. The map is context only: no check reads it. Cases whose evidence has no
// location are listed rather than placed.
import { Map, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import ocr from "../../../data/external/open-climate-risk/ocr-context.json";
import footprint from "../../../reports/earth-observation/scene-footprint.json";

setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).toString());

const pct = (value: number) => (value * 100).toFixed(value < 0.001 ? 3 : 2) + "%";
const site = ocr.buildingSite;
const scene = ocr.earthScene.statistics;

export function renderCaseMap(container: HTMLElement, select: (moduleId: string) => void): void {
  const map = new Map({
    container,
    style: "https://tiles.openfreemap.org/styles/positron",
    bounds: [[-122.5, 37.75], [-121.9, 38.85]],
    fitBoundsOptions: { padding: 32 },
    cooperativeGestures: true,
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  map.on("load", () => {
    map.addSource("cases", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              module: "earth",
              title: "Earth: HLS scene " + footprint.sceneId,
              detail:
                "Burn-scar scene, 512 × 512 pixels at 30 m. Modelled annual burn probability (Open Climate Risk, context only): mean " +
                pct(scene.bp_2011.mean) + " (~2011) → " + pct(scene.bp_2047.mean) + " (~2047).",
            },
            geometry: { type: "Polygon", coordinates: [footprint.polygon] },
          },
          {
            type: "Feature",
            properties: {
              module: "building",
              title: "Building: BDG2 site Bear",
              detail:
                "Site-level coordinates, not the building itself. Modelled annual burn probability (context only): " +
                pct(site.values.bp_2011) + " (~2011), " + pct(site.values.bp_2047) + " (~2047).",
            },
            geometry: { type: "Point", coordinates: [site.longitude, site.latitude] },
          },
        ],
      },
    });
    map.addLayer({ id: "scene-fill", type: "fill", source: "cases", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#c2410c", "fill-opacity": 0.18 } });
    map.addLayer({ id: "scene-line", type: "line", source: "cases", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#c2410c", "line-width": 2 } });
    map.addLayer({
      id: "site",
      type: "circle",
      source: "cases",
      filter: ["==", "$type", "Point"],
      paint: { "circle-radius": 7, "circle-color": "#1f6f63", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    });
    for (const layer of ["scene-fill", "site"]) {
      map.on("click", layer, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const { module, title, detail } = feature.properties as { module: string; title: string; detail: string };
        const body = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = title;
        const text = document.createElement("p");
        text.textContent = detail;
        const open = document.createElement("button");
        open.type = "button";
        open.className = "button ghost";
        open.textContent = "Open the case";
        open.addEventListener("click", () => select(module));
        body.append(heading, text, open);
        new Popup({ maxWidth: "280px" }).setLngLat(event.lngLat).setDOMContent(body).addTo(map);
      });
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    (window as unknown as { __mapReady?: boolean }).__mapReady = true;
  });
}
