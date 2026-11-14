import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { resolveTarget } from '../services/api';
import type { TargetQuery, TargetResult } from '../services/api';
import type { Position } from '../navigation/session';

interface Props { target: Position | null; onSelect: (result: TargetResult) => void }

export function TargetSearch({ target, onSelect }: Props) {
  const [mode, setMode] = useState<'name' | 'coordinates'>('name');
  const [name, setName] = useState('');
  const [ra, setRa] = useState('');
  const [dec, setDec] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  // A changed history position or unmounted view must invalidate older results.
  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [target?.ra, target?.dec]);

  function cancel() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 40000);
    const query: TargetQuery = mode === 'name' ? { kind: 'name', name } : { kind: 'coordinates', ra, dec };
    try {
      const result = await resolveTarget(query, controller.signal);
      if (pending.current !== controller || controller.signal.aborted) return;
      onSelect(result);
    } catch (failure) {
      if (pending.current !== controller) return;
      setError(timedOut ? 'The lookup timed out. Retry the search or use coordinates.' :
        failure instanceof Error && failure.name !== 'TypeError' && failure.name !== 'SyntaxError' ? failure.message :
        'The resolver could not be reached. Check the connection and retry.');
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return (
    <section className="target-search" aria-labelledby="search-heading">
      <h2 id="search-heading">Search the sky</h2>
      <p className="search-intro">Find an object by name or enter an ICRS position.</p>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy} className="search-mode">
          <legend>Search by</legend>
          <label><input type="radio" name="search-mode" value="name" checked={mode === 'name'} onChange={() => { setMode('name'); setError(null); }} /> Object name</label>
          <label><input type="radio" name="search-mode" value="coordinates" checked={mode === 'coordinates'} onChange={() => { setMode('coordinates'); setError(null); }} /> Coordinates</label>
        </fieldset>
        {mode === 'name' ? <label className="search-field">Object name or catalog identifier
          <input type="search" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required disabled={busy} autoComplete="off" />
        </label> : <div className="coordinate-fields">
          <label className="search-field">RA (degrees)<input type="text" inputMode="decimal" value={ra} onChange={(event) => setRa(event.target.value)} required disabled={busy} aria-describedby="coordinate-hint" /></label>
          <label className="search-field">Dec (degrees)<input type="text" inputMode="decimal" value={dec} onChange={(event) => setDec(event.target.value)} required disabled={busy} aria-describedby="coordinate-hint" /></label>
        </div>}
        {mode === 'coordinates' && <p id="coordinate-hint" className="field-hint">RA: 0 to less than 360°. Dec: −90 to +90°. Coordinates are not a catalog match.</p>}
        <div className="search-actions">
          <button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
          {busy && <button type="button" onClick={cancel}>Cancel search</button>}
        </div>
        {busy && <p role="status" className="field-hint">Looking up the target…</p>}
        {error && <p role="alert" className="search-error">{error}</p>}
      </form>
    </section>
  );
}
