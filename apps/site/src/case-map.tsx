// The claims on a map of the United States' wildfire risk. The base layer is CarbonPlan's Open Climate Risk v1.1.0,
// streamed tile by tile from Source Cooperative (nothing copied): annual risk to potential structures for every state,
// county, tract and block, and for each of 89.7 million buildings when zoomed in. On top: the claims whose evidence
// has a place. The map is context: no check reads it.
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
// The change from ~2011 to ~2047 in percentage points of annual risk, blue where it falls (42% of counties, mostly by
// tiny amounts, in a 2026-10-18 sample of all 3,032), neutral within ±0.0005 points, red where it rises.
const CHANGE_BREAKS = [-0.005, -0.0005, 0.0005, 0.005, 0.025, 0.1];
const CHANGE_COLOURS = ["#3d6fae", "#a8c3e2", "#efebe2", "#f3dfa2", "#f0a35e", "#d75b32", "#8e1f19"];
type Period = 2011 | 2047 | "change";
const US_BOUNDS: [[number, number], [number, number]] = [[-125, 24], [-66.5, 49.5]];
const NORTH_AMERICA: [[number, number], [number, number]] = [[-168, 8], [-52, 72]];
const CALIFORNIA: [[number, number], [number, number]] = [[-124.5, 32.5], [-114.1, 42]];

/** The paint for a period: risk in one climate, or the change between them. */
function paint(period: Period, field: { 2011: string; 2047: string }): unknown {
  const value = (key: string) => ["to-number", ["get", key]];
  const [input, breaks, colours] =
    period === "change" ? [["-", value(field[2047]), value(field[2011])], CHANGE_BREAKS, CHANGE_COLOURS] : [value(field[period]), BREAKS, COLOURS];
  return ["step", input, ...colours.flatMap((colour, index) => (index === 0 ? [colour] : [breaks[index - 1], colour]))];
}
const REGION = { 2011: FIELD.rps2011, 2047: FIELD.rps2047 };

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

let sharedMap: import("maplibre-gl").Map | undefined;
const site = ocr.buildingSite;
// NASA Ames Research Center, Moffett Field, California, where the PCoE battery tests ran (the centre's own campus).
const AMES: [number, number] = [-122.064, 37.4155];
const sceneLons = footprint.polygon.map((point: number[]) => point[0]!);
const sceneLats = footprint.polygon.map((point: number[]) => point[1]!);
const CLAIM_BOUNDS: Partial<Record<ClaimId, { bounds: [[number, number], [number, number]]; maxZoom: number }>> = {
  building: { bounds: [[site.longitude - 0.02, site.latitude - 0.015], [site.longitude + 0.02, site.latitude + 0.015]], maxZoom: 15 },
  earth: { bounds: [[Math.min(...sceneLons), Math.min(...sceneLats)], [Math.max(...sceneLons), Math.max(...sceneLats)]], maxZoom: 11 },
  carbon: { bounds: [[-106.7, 25.8], [-80.5, 42.4]], maxZoom: 6 },
  // The Indian Energy Exchange's market covers the country: the whole of India, not one site.
  energy: { bounds: [[68, 6.5], [97.5, 35.7]], maxZoom: 4.5 },
  battery: { bounds: [[AMES[0] - 0.03, AMES[1] - 0.02], [AMES[0] + 0.03, AMES[1] + 0.02]], maxZoom: 14 },
};
const PLACES = { us: { bounds: US_BOUNDS, maxZoom: 5 }, california: { bounds: CALIFORNIA, maxZoom: 6.5 } };

/** Moves the map to a claim's place (or the whole US, or California), keeping it clear of the side panel.
 * `duration` in ms: 0 jumps, leaving it out uses MapLibre's own speed. */
export function flyToClaim(id: ClaimId | keyof typeof PLACES, duration?: number): void {
  if (!sharedMap) return;
  const target = id in PLACES ? PLACES[id as keyof typeof PLACES] : CLAIM_BOUNDS[id as ClaimId];
  if (!target) return;
  const panel = document.querySelector(".panel:not(.collapsed)")?.getBoundingClientRect();
  const sheet = panel && panel.width >= window.innerWidth - 1;
  // Keep the place clear of the floating legend too: it sits at the bottom right, or at the top on phones.
  const legendBox = document.querySelector(".map-controls.floating")?.getBoundingClientRect();
  const legend = legendBox && legendBox.width > 0 ? legendBox : undefined; // a hidden legend takes no room
  const frame = sharedMap.getContainer().getBoundingClientRect();
  const legendTop = legend && legend.top < frame.top + frame.height / 2;
  // The top also leaves room for a chip above the place; a phone's bottom sheet has its Hide button above it.
  const top = (legend && legendTop ? legend.bottom - frame.top + 12 : sheet ? 10 : 70) + 30;
  const bottom = Math.max(sheet ? frame.bottom - panel!.top + 50 : 40, legend && !legendTop ? frame.bottom - legend.top + 12 : 0);
  // MapLibre will not move at all if the padding leaves no room, so keep at least 120 px of map (short phone screens).
  sharedMap.fitBounds(target.bounds, {
    maxZoom: target.maxZoom,
    ...(duration === undefined ? {} : { duration }),
    padding: { top, right: 40, bottom: Math.max(0, Math.min(bottom, frame.height - top - 120)), left: panel && !sheet ? panel.right - frame.left + 30 : 40 },
  });
}

/** A county's name as people say it: "Limestone County", "Orleans Parish"; Alaska's boroughs and census areas and
 * Virginia's independent cities ("Richmond city") keep the tiles' name as it is. State FIPS is GEOID's first two digits. */
function countyName(props: Record<string, string | number>): string {
  const name = String(props[FIELD.name] ?? "County " + props[FIELD.geoid]);
  const state = String(props[FIELD.geoid]).padStart(5, "0").slice(0, 2);
  if (state === "02" || / (city|County|Parish|Borough|Census Area|Municipality)$/.test(name)) return name;
  return name + (state === "22" ? " Parish" : " County");
}

/** How the map opens: the video tour (`?tour`), a short fly-in on the home page, or straight in. */
function intro(): "tour" | "home" | false {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (new URLSearchParams(location.search).has("tour")) return "tour";
  return location.pathname === base || location.pathname + "/" === base ? "home" : false;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Flies to a place and waits until the move ends and its tiles have drawn (or a few seconds pass). */
async function visit(id: Parameters<typeof flyToClaim>[0], ms: number): Promise<void> {
  const m = sharedMap;
  if (!m) return;
  const moved = new Promise((resolve) => m.once("moveend", resolve));
  flyToClaim(id, ms);
  await Promise.race([moved, pause(ms + 500)]);
  await Promise.race([new Promise((resolve) => m.once("idle", resolve)), pause(4000)]);
}

/** The video tour: North America, the US, California's change in risk, the burn scar, the building, and back.
 * Sets window.__tour to "done" at the end, for recording. */
async function tour(setPeriod: (period: Period) => void): Promise<void> {
  await pause(1500);
  await visit("us", 4000);
  await pause(2500);
  await visit("california", 3500);
  await pause(1500);
  setPeriod("change");
  await pause(3500);
  setPeriod(2047);
  await pause(1000);
  await visit("earth", 3500);
  await pause(3000);
  await visit("building", 3500);
  await pause(3000);
  await visit("us", 4000);
  (window as unknown as { __tour?: string }).__tour = "done";
}

/** Whether a claim has a place on the map. */
export const hasPlace = (id: ClaimId) => Boolean(CLAIM_BOUNDS[id]);

const pct = (value: number) => (value < 0.001 ? value.toFixed(4) : value < 0.1 ? value.toFixed(3) : value.toFixed(2)) + "%";
const points = (from: number, to: number) => {
  const change = to - from;
  return (change >= 0 ? "+" : "−") + pct(Math.abs(change)).replace("%", "") + " points";
};
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
  const [year, setYear] = useState<Period>(2047);
  const period = useRef(year);
  period.current = year;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const focus = /\/claims\/([a-z]+)\/?$/.exec(pathname)?.[1] as ClaimId | undefined;
  const [loaded, setLoaded] = useState(false);
  const [unit, setUnit] = useState("county");

  useEffect(() => {
    let map: import("maplibre-gl").Map | undefined;
    void Promise.all([import("maplibre-gl"), import("pmtiles"), import("maplibre-gl/dist/maplibre-gl.css")]).then(([maplibre, pmtiles]) => {
      if (!container.current) return;
      maplibre.setWorkerUrl(new URL(base + "maplibre/maplibre-gl-worker.mjs", location.href).toString());
      maplibre.addProtocol("pmtiles", new pmtiles.Protocol().tile);
      // The home page and the video tour open on all of North America, then fly in (see the framing effect below).
      const flyIn = intro();
      map = new maplibre.Map({
        container: container.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        bounds: flyIn ? NORTH_AMERICA : US_BOUNDS,
        fitBoundsOptions: { padding: 16 },
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      sharedMap = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }));

      map.on("load", () => {
        const m = map!;
        const labels = m.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
        m.addSource("ocr-regions", { type: "vector", url: "pmtiles://" + OCR + "regions.pmtiles", attribution: OCR_ATTRIBUTION });
        m.addSource("ocr-buildings", { type: "vector", url: "pmtiles://" + OCR + "building_centroids.pmtiles" });
        // Each zoom band shows the finest regions that still read as areas; buildings take over at street level.
        // Counties from the first view: state averages flatten the West's hot spots into one beige.
        for (const [layer, min, max] of [["counties", 0, 8], ["tracts", 8, 11], ["blocks", 11, 12.5]] as const) {
          m.addLayer(
            { id: "risk-" + layer, type: "fill", source: "ocr-regions", "source-layer": layer, minzoom: min, maxzoom: max, paint: { "fill-color": paint(period.current, REGION) as never, "fill-opacity": 0.62 } },
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
            paint: { "circle-color": paint(period.current, BUILDING_FIELD) as never, "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 2, 16, 5], "circle-opacity": 0.85 },
          },
          labels,
        );
        // Invisible state fills: a click anywhere in a state finds its carbon projects.
        m.addLayer({ id: "risk-states", type: "fill", source: "ocr-regions", "source-layer": "states", paint: { "fill-opacity": 0 } }, labels);
        m.addLayer({ id: "state-lines", type: "line", source: "ocr-regions", "source-layer": "states", paint: { "line-color": "#5b5446", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 8, 1.4] } }, labels);
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
              { type: "Feature", properties: { module: "battery" }, geometry: { type: "Point", coordinates: AMES } },
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
            layers: ["claim-site", "claim-area", "risk-buildings", "risk-blocks", "risk-tracts", "risk-counties"].filter((id) => m.getLayer(id)),
          });
          if (!hit) return;
          const props = hit.properties as Record<string, string | number>;
          if (hit.layer.id === "claim-site" || hit.layer.id === "claim-area") {
            const id = props.module as ClaimId;
            if (id === "battery") {
              popup(event.lngLat, claimMeta(id).claim, ["NASA Ames Research Center, where the cell was tested. The map's wildfire shading is context, not evidence."], id);
              return;
            }
            const values = id === "building" ? ocr.buildingSite.values : { bp_2011: ocr.earthScene.statistics.bp_2011.mean, bp_2047: ocr.earthScene.statistics.bp_2047.mean };
            popup(event.lngLat, claimMeta(id).claim, [
              id === "building" ? "Site-level coordinates from BDG2, not the building itself." : "The satellite scene's footprint, 512 × 512 pixels at 30 m.",
              "Annual burn probability (Open Climate Risk, context only): " + pct(values.bp_2011 * 100) + " (~2011), " + pct(values.bp_2047 * 100) + " (~2047).",
            ], id);
            return;
          }
          if (hit.layer.id === "risk-buildings") {
            popup(event.lngLat, "One building (Overture Maps footprint)", [
              "Annual risk to potential structures: " + pct(Number(props[BUILDING_FIELD[2011]])) + " (~2011), " + pct(Number(props[BUILDING_FIELD[2047]])) + " (~2047), " + points(Number(props[BUILDING_FIELD[2011]]), Number(props[BUILDING_FIELD[2047]])) + ".",
            ]);
            return;
          }
          const name = hit.layer.id === "risk-counties" ? countyName(props) : (props[FIELD.name] as string | undefined) ?? hit.layer.id.replace("risk-", "").replace(/s$/, "") + " " + props[FIELD.geoid];
          const [state] = m.queryRenderedFeatures(event.point, { layers: ["risk-states"] });
          const projects = located.states.get(String(state?.properties[FIELD.name])) ?? [];
          popup(event.lngLat, name, [
            Number(props[FIELD.buildings]).toLocaleString("en-US") + " buildings.",
            "Mean annual risk to potential structures: " + pct(Number(props[FIELD.rps2011])) + " (~2011), " + pct(Number(props[FIELD.rps2047])) + " (~2047), " + points(Number(props[FIELD.rps2011]), Number(props[FIELD.rps2047])) + ".",
            ...(projects.length ? ["Carbon projects in " + state!.properties[FIELD.name] + ", from the claim's records: " + projects.join("; ") + "."] : []),
          ], projects.length ? "carbon" : undefined);
        });
        for (const layer of ["claim-site", "claim-area", "risk-counties", "risk-tracts", "risk-blocks", "risk-buildings"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
        // Named chips for the claims, so the map says what each mark is at any zoom.
        // On phones the chips show their short name (the existing .long/.short rule at 760 px).
        const chip = (id: ClaimId, text: string, short: string, at: [number, number], anchor: "top-left" | "bottom-left" | "center", drop = 0) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "map-chip";
          button.setAttribute("aria-label", text);
          for (const [label, kind] of [[text, "long"], [short, "short"]] as const) {
            const span = document.createElement("span");
            span.className = kind;
            span.textContent = label;
            button.append(span);
          }
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            void navigate({ to: "/claims/$id", params: { id } });
          });
          new maplibre.Marker({ element: button, anchor, offset: anchor === "center" ? [0, 0] : [8, (anchor === "top-left" ? 6 : -6) + drop] }).setLngLat(at).addTo(m);
        };
        chip("building", claimMeta("building").title, "Building", [site.longitude, site.latitude], "top-left");
        chip("earth", claimMeta("earth").title, "Burn scar", [Math.min(...sceneLons), Math.max(...sceneLats)], "bottom-left");
        // NASA Ames is about 50 km from the building site, so its label sits one row lower, clear of the building's.
        chip("battery", claimMeta("battery").title + ": NASA Ames", "Battery", AMES, "top-left", 30);
        chip("energy", claimMeta("energy").title + ": Indian Energy Exchange, all of India", "Energy: India", [79, 22.5], "center");
        // One chip per state holding carbon projects, at the middle of the state's shape in the loaded tiles.
        m.once("idle", () => {
          for (const state of located.states.keys()) {
            const parts = m.querySourceFeatures("ocr-regions", { sourceLayer: "states", filter: ["==", ["get", FIELD.name], state] });
            const points = parts.flatMap((part) => (part.geometry.type === "Polygon" ? part.geometry.coordinates : part.geometry.type === "MultiPolygon" ? part.geometry.coordinates.flat() : []).flat());
            if (!points.length) continue;
            const lons = points.map((point) => point[0]!), lats = points.map((point) => point[1]!);
            const count = located.states.get(state)!.length;
            chip("carbon", "Carbon projects: " + count, "Carbon: " + count, [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2], "center");
          }
        });
        const showUnit = () => setUnit(m.getZoom() < 8 ? "county" : m.getZoom() < 11 ? "census tract" : m.getZoom() < 12.5 ? "census block" : "building");
        m.on("zoomend", showUnit);
        showUnit();
        // Start with the credits folded behind the (i) button, so they don't cover the map.
        container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        setLoaded(true);
        (window as unknown as { __mapReady?: boolean }).__mapReady = true;
      });
    });
    return () => {
      map?.remove();
      sharedMap = undefined;
    };
  }, [navigate]);

  // Switching the climate period recolours every risk layer.
  useEffect(() => {
    const m = mapRef.current;
    if (!m?.isStyleLoaded() || !m.getLayer("risk-counties")) return;
    for (const layer of ["counties", "tracts", "blocks"]) m.setPaintProperty("risk-" + layer, "fill-color", paint(year, REGION) as never);
    m.setPaintProperty("risk-buildings", "circle-color", paint(year, BUILDING_FIELD) as never);
  }, [year]);

  // Opening a claim's page moves the map to that claim's place.
  // On first load without a claim open, show the whole US beside the panel rather than under it: flying in from
  // North America on the home page, or running the whole tour with ?tour.
  const framed = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const opening = framed.current ? false : intro();
    if (opening === "tour") void tour(setYear);
    else if (focus) flyToClaim(focus);
    else if (!framed.current) flyToClaim("us", opening === "home" ? 3500 : 0);
    framed.current = true;
  }, [loaded, focus]);

  const change = year === "change";
  const colours = change ? CHANGE_COLOURS : COLOURS;
  const breaks = change ? CHANGE_BREAKS : BREAKS;
  // Tick labels sit on the boundaries between swatches; the change scale labels its middle swatch "0" instead of ±0.0005.
  const ticks: [number, string][] = change
    ? [[0, "−.005"], [3, "+.005"], [4, "+.025"], [5, "+.1"]]
    : BREAKS.map((value, index) => [index, String(value)]);

  return (
    <div className="map-app">
      <div ref={container} className="case-map" role="region" aria-label="Map of US wildfire risk with the claims that have a place" />
      <div className="map-controls floating">
        <div role="group" aria-label="Climate period" className="toggle">
          <span>Annual wildfire risk to buildings:</span>
          {([2011, 2047] as const).map((value) => (
            <button key={value} type="button" aria-pressed={year === value} onClick={() => setYear(value)}>~{value}</button>
          ))}
          <button type="button" aria-pressed={change} title="From ~2011 to ~2047, in percentage points" onClick={() => setYear("change")}>Change</button>
        </div>
        <div className="legend" aria-label={change ? "Change in annual risk from ~2011 to ~2047, percentage points" : "Annual risk to potential structures, percent a year"}>
          {colours.map((colour, index) => (
            <span key={colour} style={{ background: colour }} title={index === 0 ? "< " + breaks[0] : "≥ " + breaks[index - 1]} />
          ))}
          {ticks.map(([index, text]) => (
            <small key={text} style={{ gridColumn: index + 2 }}>{text}</small>
          ))}
          {change && <small className="legend-mid">0</small>}
          <small className="legend-unit">
            {change
              ? "change in % points, " + (unit === "building" ? "for each building" : "per " + unit)
              : unit === "building" ? "% a year, for each building" : "% a year, average per " + unit}
          </small>
        </div>
        <p className="map-source">Open Climate Risk v1.1.0, CarbonPlan</p>
      </div>
    </div>
  );
}

/** For the panel: which claims have a place, with buttons that move the map there. */
export function MapClaims() {
  return (
    <div className="map-legend-claims">
      <p className="kicker">On the map</p>
      <ul>
        <li>
          <button type="button" className="text-button" onClick={() => flyToClaim("building")}>Building emissions: the BDG2 site</button>{" "}
          (site-level point, not the building itself)
        </li>
        <li>
          <button type="button" className="text-button" onClick={() => flyToClaim("earth")}>Burn scar: the satellite scene</button> (outlined)
        </li>
        <li>
          <button type="button" className="text-button" onClick={() => flyToClaim("carbon")}>
            Carbon registry: {usProjects} projects in {[...located.states.keys()].join(" and ")}
          </button>{" "}
          (dashed states). The records name {sampleProjects} projects; the pinned project list places {usProjects} of them in US
          states{located.elsewhere.length ? " and " + located.elsewhere.length + " outside the US" : ""}. The other{" "}
          {sampleProjects - usProjects - located.elsewhere.length} have no location in the committed records.
        </li>
        <li>
          <button type="button" className="text-button" onClick={() => flyToClaim("us")}>The whole United States</button>: wildfire risk to
          buildings, by county, tract and block, and for each building when you zoom in; "Change" shows where it rises or falls by ~2047.
        </li>
      </ul>
      <p className="note">
        Also on the map: the battery cell's test site, NASA Ames, and the energy forecast's market, the whole of India. Not on the
        map: the company disclosure, whose page names no site.
        (Overture Maps Places has one "LPL Construction Ltd", in Alberta, Canada, with nothing tying it to the claim, so it is not used.)
      </p>
    </div>
  );
}
