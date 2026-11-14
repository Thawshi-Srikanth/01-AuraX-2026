import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { fetchTargetSpectrum } from '../services/api';
import { createWavelengthLoader, type WavelengthState } from '../utils/wavelengthRequests';
import type { WavelengthPosition } from '../utils/wavelengthPosition';
import './wavelengthSheet.css';

export function WavelengthSheet({ position, onClose }: { position: WavelengthPosition; onClose: () => void }) {
  const [loader] = useState(() => createWavelengthLoader(fetchTargetSpectrum));
  const [state, setState] = useState<WavelengthState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  useEffect(() => {
    setState({ status: 'loading' });
    // Wait for a short pause in image clicks before starting another archive operation.
    const timer = window.setTimeout(() => { void loader.select(position, setState, retry > 0); }, 180);
    return () => { window.clearTimeout(timer); loader.cancel(); };
  }, [position, retry, loader]);
  const points = state.status === 'ready' ? state.spectrum.spectral_points : [];
  return <aside className="wavelength-sheet" aria-label="Wavelengths">
    <header><h2>Wavelengths</h2><button ref={close} type="button" aria-label="Close wavelengths" onClick={onClose}><X size={18} /></button></header>
    <div className="wavelength-sheet-body">
      <p className="wavelength-position-name">{position.label}</p>
      <p className="wavelength-note">RA {position.ra.toFixed(6)}° · Dec {position.dec.toFixed(6)}°</p>
      {state.status === 'loading' && <p role="status">Loading measured samples…</p>}
      {state.status === 'error' && <div role="alert"><p>{state.message}</p><button className="wavelength-retry" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {state.status === 'ready' && <>
        <p className="wavelength-note">{points.length} measured {points.length === 1 ? 'sample' : 'samples'} · MJy/sr</p>
        <table><thead><tr><th>Wavelength<br /><small>µm</small></th><th>Brightness<br /><small>MJy/sr</small></th><th>Uncertainty<br /><small>± MJy/sr</small></th></tr></thead>
          <tbody>{points.map((point, index) => <tr key={index}><td>{point.wavelength_um.toFixed(4)}</td><td>{point.flux_mjy_sr.toPrecision(5)}</td><td>{point.flux_error_mjy_sr.toPrecision(3)}</td></tr>)}</tbody>
        </table>
        <p className="wavelength-note">Nearest-pixel surface brightness, not total source flux. Samples may come from different dates; this is not a continuous spectrum.</p>
        {state.spectrum.message && <p className="wavelength-note">{state.spectrum.message}</p>}
      </>}
    </div>
  </aside>;
}
