import { useEffect, useState } from 'react';
import { fetchHealth } from './services/api';
import { views, routeUrl } from './navigation/session';
import { useNavigation } from './navigation/useNavigation';

type Connection = 'checking' | 'connected' | 'unavailable';
const labels: Record<Connection, string> = {
  checking: 'Checking connection',
  connected: 'Backend connected',
  unavailable: 'Backend unavailable',
};

export function App() {
  const { route, navigate } = useNavigation();
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
          <p className="target-position">ICRS position · RA {route.target.ra}° · Dec {route.target.dec}°
            <span>Coordinates only; no catalog match verified.</span>
          </p>
        )}
        <section className="empty-workspace" aria-labelledby="empty-heading">
          <div>
            {route.error ? <>
              <h2 id="empty-heading">Unable to open this link</h2>
              <p role="alert">{route.error}</p>
              <a className="action-link" href="/" onClick={(event) => navigate(event, 'home', null)}>Open Home</a>
            </> : route.view === 'home' ? <>
              <p className="eyebrow">Target</p>
              <h2 id="empty-heading">{route.target ? 'No observation selected' : 'No target selected'}</h2>
              <p>{route.target ? 'A sky position is selected. No observation has been loaded.' : 'Select a sky position to view its observations.'}</p>
            </> : <>
              <h2 id="empty-heading">View unavailable</h2>
              <p>{currentView.label} tools are not available yet.</p>
              <a className="action-link" href={routeUrl('home', route.target)} onClick={(event) => navigate(event, 'home')}>Open Home</a>
            </>}
          </div>
        </section>
      </main>
      <footer><span>AURAx</span><p>Connection status checks the API only. Archive availability is checked separately.</p></footer>
    </div>
  );
}
