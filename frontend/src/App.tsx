import { useEffect, useState } from 'react';
import { fetchHealth } from './services/api';

type Connection = 'checking' | 'connected' | 'unavailable';
const labels: Record<Connection, string> = {
  checking: 'Checking connection',
  connected: 'Backend connected',
  unavailable: 'Backend unavailable',
};

export function App() {
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
        <a className="brand" href="/" aria-label="AURAx home">
          <img src="/aura.svg" alt="" width="40" height="25" />
          <span>AURAx</span>
        </a>
        <nav aria-label="Main navigation"><a href="#workspace" aria-current="page">Workspace</a></nav>
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
        <div className="workspace-heading"><h1>Workspace</h1><span>SPHEREx observations</span></div>
        {connection === 'unavailable' && (
          <p className="connection-warning">The backend could not be reached. Check that it is running, then retry.</p>
        )}
        <section className="empty-workspace" aria-labelledby="empty-heading">
          <div>
            <p className="eyebrow">Target</p>
            <h2 id="empty-heading">No target selected</h2>
            <p>Select a sky position to view its observations.</p>
          </div>
        </section>
      </main>
      <footer><span>AURAx</span><p>Connection status checks the API only. Archive availability is checked separately.</p></footer>
    </div>
  );
}
