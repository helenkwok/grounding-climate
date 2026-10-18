import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { CaseMap } from "../case-map";
import { SiteHeader } from "../components";
import "../styles/app.css";

const fonts =
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;600&family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,600;0,800;1,400&display=swap";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "description",
        content:
          "Grounding shows what a climate figure rests on: the source data, the analysis rerun in your browser, every call a person made, and a signature that breaks if any of it changes.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: fonts },
      // The map's hosts: open the connections while the page loads, before MapLibre asks for its first tile.
      { rel: "preconnect", href: "https://tiles.openfreemap.org", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://data.source.coop", crossOrigin: "anonymous" },
    ],
  }),
  component: App,
});

/** The map fills the window and stays mounted; each page opens in the panel beside it. */
function App() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const wide = /\/(verify|how-it-fits)\/?$/.test(pathname);
  // A claim page draws its own evidence full width, with its own map of where the evidence comes from.
  const full = /\/(claims\/[a-z]+|judge)\/?$/.test(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const panel = useRef<HTMLElement>(null);
  // A new page opens the panel at its top.
  useEffect(() => {
    setCollapsed(false);
    panel.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip" href="#panel">Skip to content</a>
        {full ? (
          <div className="app-full">
            <SiteHeader />
            <main id="panel" className="page-full"><Outlet /></main>
          </div>
        ) : (
        <div className={"app" + (wide ? " wide" : "") + (collapsed ? " collapsed" : "")}>
          <SiteHeader />
          <CaseMap />
          <main id="panel" ref={panel} className={"panel" + (wide ? " wide" : "") + (collapsed ? " collapsed" : "")} aria-label="Content">
            <Outlet />
            <footer className="panel-foot">
              <p>Third-party data is shown or bundled only where its licence allows, with attribution. Map data: OpenFreeMap, OpenStreetMap, Open Climate Risk (CarbonPlan), Overture Maps.</p>
            </footer>
          </main>
          <button type="button" className="panel-toggle" aria-expanded={!collapsed} aria-controls="panel" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? "Show panel" : "Hide panel"}
          </button>
        </div>
        )}
        <Scripts />
      </body>
    </html>
  );
}
