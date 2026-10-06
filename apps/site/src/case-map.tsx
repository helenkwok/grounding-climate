// The claims on a map of the United States' wildfire risk. The base layer is CarbonPlan's Open Climate Risk v1.1.0,
// streamed tile by tile from Source Cooperative (nothing copied): annual risk to potential structures for every state,
// county, tract and block, and for each of 89.7 million buildings when zoomed in. On top: the claims whose evidence
// has a place. The map is context: no check reads it.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import issuancesCsv from "../../../data/external/acr-offsetsdb/issuances.csv";
import projectsCsv from "../../../data/external/acr-offsetsdb/projects.csv";
import retirementsCsv from "../../../data/external/acr-offsetsdb/retirements.csv";
import ocr from "../../../data/external/open-climate-risk/ocr-context.json";
import footprint from "../../../reports/earth-observation/scene-footprint.json";
import { claimMeta, type ClaimId } from "../../demo/src/claims-meta";
import { base } from "./live";

const OCR = "https://data.source.coop/carbonplan/carbonplan-ocr/output/fire-risk/vector/production/v1.1.0/pmtiles/";
const OCR_ATTRIBUTION =
  '<a href="https://source.coop/carbonplan/carbonplan-ocr">Open Climate Risk v1.1.0</a>, CarbonPlan (ODbL; contains Overture Maps data, © OpenStreetMap contributors); USFS RDS-2025-0006, RDS-2020-0016-2; CONUS404';
// Region tiles store their fields under numbered keys; these were matched against CarbonPlan's published state CSV.
const FIELD = { buildings: "0", rps2011: "1", rps2047: "2", geoid: "7", name: "9" } as const;
// Building centroids: "0" is ~2011 and "1" is ~2047, both annual risk to potential structures in %.
const BUILDING_FIELD = { 2011: "0", 2047: "1" } as const;
const BREAKS = [0.01, 0.05, 0.1, 0.25, 0.5, 1];
const COLOURS = ["#f4efe1", "#f3dfa2", "#f0c070", "#e8924c", "#d75b32", "#b02c22", "#741816"];
const US_BOUNDS: [[number, number], [number, number]] = [[-125, 24], [-66.5, 49.5]];

/** The committed ACR projects that the pinned project list places, grouped by US state. */
function projectsByState(): { states: Map<string, string[]>; elsewhere: string[] } {
  const [header, ...lines] = projectsCsv.trim().split("\n");
  const columns = header!.split(",");
  const states = new Map<string, string[]>();
  const elsewhere: string[] = [];
  for (const line of lines) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, "").replaceAll('""', '"'));
    const row = Object.fromEntries(columns.map((name, index) => [name, cells[index] ?? ""]));
    const label = row["Project ID"] + " " + row["Project Name"] + " (" + row["Project Type"] + ")";
    if (row["Project Site Country"] !== "US") {
      elsewhere.push(label + ", " + row["Project Site State"] + ", " + row["Project Site Country"]);
      continue;
    }
    for (const state of row["Project Site State"]!.split(";")) {
      const name = state.trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
      states.set(name, [...(states.get(name) ?? []), label]);
    }
  }
  return { states, elsewhere };
}

const pct = (value: number) => (value < 0.001 ? value.toFixed(4) : value < 0.1 ? value.toFixed(3) : value.toFixed(2)) + "%";
const located = projectsByState();
const usProjects = new Set([...located.states.values()].flat()).size;
// Every project in the claim's records: the first column of the issuance and retirement files.
const sampleProjects = new Set(
  [issuancesCsv, retirementsCsv].flatMap((csv) => csv.trim().split("\n").slice(1).map((line) => line.split(",")[0])),
).size;

export function CaseMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map>();
  const navigate = useNavigate();
  const [year, setYear] = useState<2011 | 2047>(2047);

  useEffect(() => {
    let map: import("maplibre-gl").Map | undefined;
    void Promise.all([import("maplibre-gl"), import("pmtiles"), import("maplibre-gl/dist/maplibre-gl.css")]).then(([maplibre, pmtiles]) => {
      if (!container.current) return;
      maplibre.setWorkerUrl(new URL(base + "maplibre/maplibre-gl-worker.mjs", location.href).toString());
      maplibre.addProtocol("pmtiles", new pmtiles.Protocol().tile);
      map = new maplibre.Map({
        container: container.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        bounds: US_BOUNDS,
        fitBoundsOptions: { padding: 16 },
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }));

      map.on("load", () => {
        const m = map!;
        const labels = m.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
        m.addSource("ocr-regions", { type: "vector", url: "pmtiles://" + OCR + "regions.pmtiles", attribution: OCR_ATTRIBUTION });
        m.addSource("ocr-buildings", { type: "vector", url: "pmtiles://" + OCR + "building_centroids.pmtiles" });
        const colour = (key: string) => ["step", ["to-number", ["get", key]], ...COLOURS.flatMap((colour, index) => (index === 0 ? [colour] : [BREAKS[index - 1], colour]))];
        // Each zoom band shows the finest regions that still read as areas; buildings take over at street level.
        for (const [layer, min, max] of [["states", 0, 5], ["counties", 5, 8], ["tracts", 8, 11], ["blocks", 11, 12.5]] as const) {
          m.addLayer(
            { id: "risk-" + layer, type: "fill", source: "ocr-regions", "source-layer": layer, minzoom: min, maxzoom: max, paint: { "fill-color": colour(FIELD.rps2047) as never, "fill-opacity": 0.62 } },
            labels,
          );
        }
        m.addLayer(
          {
            id: "risk-buildings",
            type: "circle",
            source: "ocr-buildings",
            "source-layer": "risk",
            minzoom: 12.5,
            paint: { "circle-color": colour(BUILDING_FIELD[2047]) as never, "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 2, 16, 5], "circle-opacity": 0.85 },
          },
          labels,
        );
        m.addLayer({ id: "state-lines", type: "line", source: "ocr-regions", "source-layer": "states", paint: { "line-color": "#6b6455", "line-width": 0.6 } }, labels);
        // States holding carbon projects from the claim's records.
        m.addLayer({
          id: "carbon-states",
          type: "line",
          source: "ocr-regions",
          "source-layer": "states",
          filter: ["in", ["get", FIELD.name], ["literal", [...located.states.keys()]]],
          paint: { "line-color": "#1f3a8a", "line-width": 3, "line-dasharray": [2, 1] },
        });

        m.addSource("claims", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: { module: "earth" }, geometry: { type: "Polygon", coordinates: [footprint.polygon] } },
              { type: "Feature", properties: { module: "building" }, geometry: { type: "Point", coordinates: [ocr.buildingSite.longitude, ocr.buildingSite.latitude] } },
            ],
          },
        });
        m.addLayer({ id: "claim-area", type: "line", source: "claims", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#1f3a8a", "line-width": 3 } });
        m.addLayer({
          id: "claim-site",
          type: "circle",
          source: "claims",
          filter: ["==", "$type", "Point"],
          paint: { "circle-radius": 8, "circle-color": "#1f3a8a", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 },
        });

        const popup = (lngLat: import("maplibre-gl").LngLatLike, title: string, lines: string[], claim?: ClaimId) => {
          const body = document.createElement("div");
          const heading = document.createElement("strong");
          heading.textContent = title;
          body.append(heading);
          for (const line of lines) {
            const text = document.createElement("p");
            text.textContent = line;
            body.append(text);
          }
          if (claim) {
            const open = document.createElement("button");
            open.type = "button";
            open.className = "button";
            open.textContent = "Review this claim";
            open.addEventListener("click", () => void navigate({ to: "/claims/$id", params: { id: claim } }));
            body.append(open);
          }
          new maplibre.Popup({ maxWidth: "320px" }).setLngLat(lngLat).setDOMContent(body).addTo(m);
        };

        m.on("click", (event) => {
          const [hit] = m.queryRenderedFeatures(event.point, {
            layers: ["claim-site", "claim-area", "risk-buildings", "risk-blocks", "risk-tracts", "risk-counties", "risk-states"].filter((id) => m.getLayer(id)),
          });
          if (!hit) return;
          const props = hit.properties as Record<string, string | number>;
          if (hit.layer.id === "claim-site" || hit.layer.id === "claim-area") {
            const id = props.module as ClaimId;
            const values = id === "building" ? ocr.buildingSite.values : { bp_2011: ocr.earthScene.statistics.bp_2011.mean, bp_2047: ocr.earthScene.statistics.bp_2047.mean };
            popup(event.lngLat, claimMeta(id).claim, [
              id === "building" ? "Site-level coordinates from BDG2, not the building itself." : "The satellite scene's footprint, 512 × 512 pixels at 30 m.",
              "Annual burn probability (Open Climate Risk, context only): " + pct(values.bp_2011 * 100) + " (~2011), " + pct(values.bp_2047 * 100) + " (~2047).",
            ], id);
            return;
          }
          if (hit.layer.id === "risk-buildings") {
            popup(event.lngLat, "One building (Overture Maps footprint)", [
              "Annual risk to potential structures: " + pct(Number(props[BUILDING_FIELD[2011]])) + " (~2011), " + pct(Number(props[BUILDING_FIELD[2047]])) + " (~2047).",
            ]);
            return;
          }
          const name = (props[FIELD.name] as string | undefined) ?? hit.layer.id.replace("risk-", "").replace(/s$/, "") + " " + props[FIELD.geoid];
          const projects = hit.layer.id === "risk-states" ? located.states.get(String(props[FIELD.name])) ?? [] : [];
          popup(event.lngLat, name, [
            Number(props[FIELD.buildings]).toLocaleString("en-US") + " buildings.",
            "Mean annual risk to potential structures: " + pct(Number(props[FIELD.rps2011])) + " (~2011), " + pct(Number(props[FIELD.rps2047])) + " (~2047).",
            ...(projects.length ? ["Carbon projects in the claim's records: " + projects.join("; ") + "."] : []),
          ], projects.length ? "carbon" : undefined);
        });
        for (const layer of ["claim-site", "claim-area", "risk-states", "risk-counties", "risk-tracts", "risk-blocks", "risk-buildings"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
        // Start with the credits folded behind the (i) button, so they don't cover the map.
        container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        (window as unknown as { __mapReady?: boolean }).__mapReady = true;
      });
    });
    return () => map?.remove();
  }, [navigate]);

  // Switching the climate period recolours every risk layer.
  useEffect(() => {
    const m = mapRef.current;
    if (!m?.isStyleLoaded() || !m.getLayer("risk-states")) return;
    const step = (key: string) => ["step", ["to-number", ["get", key]], ...COLOURS.flatMap((colour, index) => (index === 0 ? [colour] : [BREAKS[index - 1], colour]))];
    for (const layer of ["states", "counties", "tracts", "blocks"]) m.setPaintProperty("risk-" + layer, "fill-color", step(year === 2011 ? FIELD.rps2011 : FIELD.rps2047));
    m.setPaintProperty("risk-buildings", "circle-color", step(BUILDING_FIELD[year]));
  }, [year]);

  const fly = (bounds: [[number, number], [number, number]], maxZoom = 12) => mapRef.current?.fitBounds(bounds, { padding: 40, maxZoom });
  const site = ocr.buildingSite;
  const lons = footprint.polygon.map((point: number[]) => point[0]!);
  const lats = footprint.polygon.map((point: number[]) => point[1]!);

  return (
    <div className="map-block">
      <div className="map-controls">
        <div role="group" aria-label="Climate period" className="toggle">
          <span>Annual wildfire risk to buildings, climate of</span>
          {([2011, 2047] as const).map((value) => (
            <button key={value} type="button" aria-pressed={year === value} onClick={() => setYear(value)}>~{value}</button>
          ))}
        </div>
        <div className="legend" aria-label="Annual risk to potential structures, percent">
          {COLOURS.map((colour, index) => (
            <span key={colour} style={{ background: colour }} title={index === 0 ? "< " + BREAKS[0] + "%" : "≥ " + BREAKS[index - 1] + "%"} />
          ))}
          <small>&lt;0.01%</small><small>≥1% a year</small>
        </div>
      </div>
      <div ref={container} className="case-map" role="region" aria-label="Map of US wildfire risk with the claims that have a place" />
      <div className="map-legend-claims">
        <p className="kicker">Claims with a place in their evidence</p>
        <ul>
          <li>
            <button type="button" className="text-button" onClick={() => fly([[site.longitude - 0.02, site.latitude - 0.015], [site.longitude + 0.02, site.latitude + 0.015]], 15)}>
              Building emissions: the BDG2 site
            </button>{" "}
            (site-level point, not the building itself)
          </li>
          <li>
            <button type="button" className="text-button" onClick={() => fly([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]])}>
              Burn scar: the satellite scene
            </button>{" "}
            (outlined)
          </li>
          <li>
            <button type="button" className="text-button" onClick={() => fly(US_BOUNDS)}>
              Carbon registry: {usProjects} projects in {[...located.states.keys()].join(" and ")}
            </button>{" "}
            (dashed states). The records name {sampleProjects} projects; the pinned project list places {usProjects} of them in US
            states{located.elsewhere.length ? " and " + located.elsewhere.length + " outside the US" : ""}. The other{" "}
            {sampleProjects - usProjects - located.elsewhere.length} have no location in the committed records.
          </li>
        </ul>
        <p className="note">
          Not on the map: the energy forecast, the battery cell and the company disclosure carry no location in their evidence.
          (Overture Maps Places has one "LPL Construction Ltd", in Alberta, Canada, with nothing tying it to the claim, so it is not used.)
        </p>
      </div>
    </div>
  );
}
