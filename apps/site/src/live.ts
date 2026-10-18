// The live checks, loaded only in the browser: prerendered pages carry the words, and each check runs here after
// the page loads, on the committed data, with the same code as the offline runs.
import { useEffect, useState } from "react";

import type { ClaimId } from "../../demo/src/claims-meta";
import type { DemoModule } from "../../demo/src/modules";

/** The site's root URL, with a trailing slash (a GitHub Pages project site lives below /<repo>/). */
export const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
// The earth scene arrays are fetched from the site root, not from the page's own folder. Set before any live
// module loads, since the shared module builders import all of them.
(globalThis as { groundingDataBase?: string }).groundingDataBase = base;

const builders: Record<ClaimId, () => Promise<DemoModule>> = {
  building: async () => {
    const [m, live] = await Promise.all([import("../../demo/src/modules"), import("../../demo/src/building-live")]);
    return m.buildingModule(await live.checkBuilding());
  },
  energy: async () => {
    const [m, live] = await Promise.all([import("../../demo/src/modules"), import("../../demo/src/energy-live")]);
    return m.energyModule(await live.checkEnergy());
  },
  earth: async () => {
    const [m, live] = await Promise.all([import("../../demo/src/modules"), import("../../demo/src/earth-live")]);
    return m.earthModule(await live.checkEarth());
  },
  battery: async () => {
    const [m, live] = await Promise.all([import("../../demo/src/modules"), import("../../demo/src/battery-live")]);
    return m.batteryModule(await live.checkBattery());
  },
  carbon: async () => {
    const [m, live] = await Promise.all([import("../../demo/src/modules"), import("../../demo/src/carbon-live")]);
    return m.carbonModule(await live.checkCarbon());
  },
  disclosure: async () => {
    const [m, live] = await Promise.all([import("../../demo/src/modules"), import("../../demo/src/disclosure-live")]);
    return m.disclosureModule(await live.checkDisclosure());
  },
};

/** One claim, rebuilt and checked in this browser. */
export const loadClaim = (id: ClaimId): Promise<DemoModule> => builders[id]();

const tamperSwitches: Record<ClaimId, () => Promise<(on: boolean) => void>> = {
  building: async () => (await import("../../demo/src/building-live")).setTampered,
  energy: async () => (await import("../../demo/src/energy-live")).setEnergyTampered,
  earth: async () => (await import("../../demo/src/earth-live")).setEarthTampered,
  battery: async () => (await import("../../demo/src/battery-live")).setBatteryTampered,
  carbon: async () => (await import("../../demo/src/carbon-live")).setCarbonTampered,
  disclosure: async () => (await import("../../demo/src/disclosure-live")).setDisclosureTampered,
};

/** Changes one input of a claim in this browser (or restores it), then rebuilds and rechecks the claim. */
export async function setTampered(id: ClaimId, on: boolean): Promise<DemoModule> {
  (await tamperSwitches[id]())(on);
  return loadClaim(id);
}

/** Records signed in this browser during this visit, newest first; they live only in this tab's memory. */
export const signedRecords: Array<{ claimId: ClaimId; record: import("./signing").SignedRecord; verdict: string; signedAt: string }> = [];

/** Runs an async browser-only task after the page loads; undefined until it settles, an Error if it failed. */
export function useLive<T>(task: () => Promise<T>, deps: readonly unknown[]): T | Error | undefined {
  const [value, setValue] = useState<T | Error>();
  useEffect(() => {
    let current = true;
    setValue(undefined);
    task().then(
      (result) => current && setValue(result),
      (error: unknown) => current && setValue(error instanceof Error ? error : new Error(String(error))),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
