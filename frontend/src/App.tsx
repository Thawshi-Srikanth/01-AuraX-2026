import { useEffect, useState } from 'react';
import { fetchHealth } from './services/api';
import type { TargetResult } from './services/api';
import { TargetSearch } from './components/TargetSearch';
import { views, routeUrl } from './navigation/session';
import { useNavigation } from './navigation/useNavigation';

type Connection = 'checking' | 'connected' | 'unavailable';
const labels: Record<Connection, string> = {
  checking: 'Checking connection',
  connected: 'Backend connected',
  unavailable: 'Backend unavailable',
};

export function App() {
  const { route, navigate, selectTarget } = useNavigation();
  const [resolved, setResolved] = useState<TargetResult | null>(null);
  const selected = resolved && route.target?.ra === resolved.coordinates.ra_deg && route.target?.dec === resolved.coordinates.dec_deg ? resolved : null;
  function select(result: TargetResult) {
    setResolved(result);
    selectTarget({ ra: result.coordinates.ra_deg, dec: result.coordinates.dec_deg });
  }
  const currentView = views.find((view) => view.id === route.view)!;
  const [connection, setConnection] = useState<Connection>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetchHealth(controller.signal)
      .then(() => { if (active) setConnection('connected'); })
      .catch(() => { if (active) setConnection('unavailable'); })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt]);

  function checkConnection() {
    setConnection('checking');
    setAttempt((current) => current + 1);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <header className="app-header">
        <a className="brand" href={routeUrl('home', route.target)} onClick={(event) => navigate(event, 'home')} aria-label="AURAx home">
          <img src="/aura.svg" alt="" width="40" height="25" />
          <span>AURAx</span>
        </a>
        <nav aria-label="Main navigation">{views.map((view) => (
          <a key={view.id} href={routeUrl(view.id, route.target)}
            onClick={(event) => navigate(event, view.id)}
            aria-current={!route.error && route.view === view.id ? 'page' : undefined}>
            {view.label}
          </a>
        ))}</nav>
        <div className="connection-tools">
          <p className="connection" data-state={connection} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />{labels[connection]}
          </p>
          <button type="button" onClick={checkConnection} disabled={connection === 'checking'}>
            {connection === 'unavailable' ? 'Retry connection' : 'Check connection'}
          </button>
        </div>
      </header>
      <main id="workspace" tabIndex={-1}>
        <div className="workspace-heading"><h1>{route.error ? 'Invalid link' : currentView.label}</h1><span>SPHEREx observations</span></div>
        {connection === 'unavailable' && (
          <p className="connection-warning">The backend could not be reached. Check that it is running, then retry.</p>
        )}
        {route.target && !route.error && (
          <section className="target-position" aria-label="Selected target">
            <strong>{selected?.canonical_name || 'ICRS position'}</strong>
            <span>RA {route.target.ra}° · Dec {route.target.dec}° · ICRS</span>
            <span>{selected?.provenance || 'Coordinates only; no catalog match verified.'}</span>
            {selected && <>
              <span>Type: {selected.object_type} · Coordinate epoch: {selected.coordinates.epoch || 'Not supplied'}</span>
              {selected.coordinate_reference && <span>Coordinate reference: {selected.coordinate_reference}</span>}
              {selected.source_url && <a href={selected.source_url} target="_blank" rel="noopener noreferrer">Catalog source</a>}
            </>}
          </section>
        )}
        {route.view === 'home' && !route.error ? <TargetSearch target={route.target} onSelect={select} /> :
        <section className="empty-workspace" aria-labelledby="empty-heading">
          <div>
            {route.error ? <>
              <h2 id="empty-heading">Unable to open this link</h2>
              <p role="alert">{route.error}</p>
              <a className="action-link" href="/" onClick={(event) => navigate(event, 'home', null)}>Open Home</a>
            </> : <>
              <h2 id="empty-heading">View unavailable</h2>
              <p>{currentView.label} tools are not available yet.</p>
              <a className="action-link" href={routeUrl('home', route.target)} onClick={(event) => navigate(event, 'home')}>Open Home</a>
            </>}
          </div>
        </section>}
      </main>
      <footer><span>AURAx</span><p>Connection status checks the API only. Archive availability is checked separately.</p></footer>
    </div>
  );
}
