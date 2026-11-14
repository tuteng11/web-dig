import { useEffect, useMemo } from "react";
import { LIVE_NOT_IMPLEMENTED_MESSAGE, readRuntimeConfig } from "./config";
import { FixtureExplorer } from "./FixtureExplorer";

function LiveUnavailableState() {
  return (
    <div className="app-shell">
      <header className="live-header">
        <p className="eyebrow">News Trace</p>
        <h1>Chronological source explorer</h1>
      </header>
      <main className="workspace-main">
        <section className="state-card state-live" role="alert">
          <p className="eyebrow">Live mode</p>
          <h2>{LIVE_NOT_IMPLEMENTED_MESSAGE}</h2>
          <p>
            This build supports an explicit synthetic fixture explorer only.
            Fixture mode was not enabled, so no fixture data was loaded and no
            live discovery was attempted.
          </p>
          <p>
            To run the fixture milestone locally, configure{" "}
            <code>VITE_FIXTURE_MODE=true</code> and start the local gateway.
          </p>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const config = useMemo(() => readRuntimeConfig(), []);

  useEffect(() => {
    document.title = config.fixtureMode
      ? "News Trace — Synthetic demo"
      : "News Trace";
  }, [config.fixtureMode]);

  if (!config.fixtureMode) {
    return <LiveUnavailableState />;
  }

  return <FixtureExplorer config={config} />;
}
