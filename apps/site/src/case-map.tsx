// Where the claims are: the building site and the satellite scene footprint, from their committed evidence, on
// OpenFreeMap vector tiles drawn by MapLibre. Context only: no check reads the map. Claims whose evidence has no
// location are listed beside it, not placed.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import ocr from "../../../data/external/open-climate-risk/ocr-context.json";
import footprint from "../../../reports/earth-observation/scene-footprint.json";
import { claimMeta } from "../../demo/src/claims-meta";
import { base } from "./live";

const pct = (value: number) => (value * 100).toFixed(value < 0.001 ? 3 : 2) + "%";

export function CaseMap() {
  const container = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let map: import("maplibre-gl").Map | undefined;
    void Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]).then(([maplibre]) => {
      if (!container.current) return;
      maplibre.setWorkerUrl(new URL(base + "maplibre/maplibre-gl-worker.mjs", location.href).toString());
      map = new maplibre.Map({
        container: container.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        bounds: [[-122.5, 37.75], [-121.9, 38.85]],
        fitBoundsOptions: { padding: 32 },
        cooperativeGestures: true,
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }));
      const site = ocr.buildingSite;
      const scene = ocr.earthScene.statistics;
      map.on("load", () => {
        map!.addSource("cases", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {
                  module: "earth",
                  title: claimMeta("earth").claim,
                  detail: "Scene footprint, 512 × 512 pixels at 30 m. Modelled annual burn probability (Open Climate Risk, context only): " +
                    pct(scene.bp_2011.mean) + " (~2011) → " + pct(scene.bp_2047.mean) + " (~2047).",
                },
                geometry: { type: "Polygon", coordinates: [footprint.polygon] },
              },
              {
                type: "Feature",
                properties: {
                  module: "building",
                  title: claimMeta("building").claim,
                  detail: "Site-level coordinates from BDG2, not the building itself. Modelled annual burn probability (context only): " +
                    pct(site.values.bp_2011) + " (~2011), " + pct(site.values.bp_2047) + " (~2047).",
                },
                geometry: { type: "Point", coordinates: [site.longitude, site.latitude] },
              },
            ],
          },
        });
        map!.addLayer({ id: "scene-fill", type: "fill", source: "cases", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#c2410c", "fill-opacity": 0.18 } });
        map!.addLayer({ id: "scene-line", type: "line", source: "cases", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#c2410c", "line-width": 2 } });
        map!.addLayer({
          id: "site",
          type: "circle",
          source: "cases",
          filter: ["==", "$type", "Point"],
          paint: { "circle-radius": 8, "circle-color": "#1f6f63", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
        });
        for (const layer of ["scene-fill", "site"]) {
          map!.on("click", layer, (event) => {
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
            open.className = "button";
            open.textContent = "Review this claim";
            open.addEventListener("click", () => void navigate({ to: "/claims/$id", params: { id: module } }));
            body.append(heading, text, open);
            new maplibre.Popup({ maxWidth: "300px" }).setLngLat(event.lngLat).setDOMContent(body).addTo(map!);
          });
          map!.on("mouseenter", layer, () => (map!.getCanvas().style.cursor = "pointer"));
          map!.on("mouseleave", layer, () => (map!.getCanvas().style.cursor = ""));
        }
        (window as unknown as { __mapReady?: boolean }).__mapReady = true;
      });
    });
    return () => map?.remove();
  }, [navigate]);

  return <div ref={container} className="case-map" role="region" aria-label="Map of the building site and the satellite scene" />;
}
