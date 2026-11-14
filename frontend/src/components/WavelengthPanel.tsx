import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fetchCachedSample, fetchTargetSpectrum, type SpectralPoint } from '../services/api';
import type { ObservationFrame } from '../utils/observationFrames';
import { createWavelengthLoader, type WavelengthState } from '../utils/wavelengthRequests';
import { chartSamples, mergeSamples } from '../utils/wavelengthChart';
import type { WavelengthPosition } from '../utils/wavelengthPosition';
import './wavelengthPanel.css';

interface Props { position: WavelengthPosition; frame: ObservationFrame | null; centerRa: number; centerDec: number; size: number; imageMessage?: string; onClose: () => void }
export function WavelengthPanel({ position, frame, centerRa, centerDec, size, imageMessage, onClose }: Props) {
  const [sample, setSample] = useState<SpectralPoint | null>(null);
  const [notice, setNotice] = useState('Waiting for the selected image…');
  const [more, setMore] = useState<WavelengthState | null>(null);
  const [loader] = useState(() => createWavelengthLoader(fetchTargetSpectrum));
  const [active, setActive] = useState(0);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    if (!plot.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width)));
    observer.observe(plot.current);
    return () => observer.disconnect();
  }, []);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loader.cancel(); }; }, [loader]);
  useEffect(() => {
    if (!frame) return;
    let current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setNotice('Reading the selected image…');
      fetchCachedSample(frame.observation.access_url, centerRa, centerDec, size, position.ra, position.dec, controller.signal).then(result => {
        if (!current) return;
        if (result.sample) {
          setSample({ ...result.sample, source_url: result.source_url, channel_index: 0, detector: frame.observation.detector, obs_id: frame.observation.obs_id, utc_date: frame.observation.utc_date, snr: result.sample.snr ?? NaN });
          setNotice('Displayed image · more wavelengths may be available');
        } else setNotice('This image pixel is masked. You can request other observations.');
      }).catch(error => { if (current) setNotice(error instanceof Error ? error.message : 'Cached measurement unavailable.'); });
    }, 120);
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [frame, centerRa, centerDec, size, position]);
  const points = useMemo(() => mergeSamples([...(sample ? [sample] : []), ...(more?.status === 'ready' ? more.spectrum.spectral_points : [])]), [sample, more]);
  const chart = useMemo(() => chartSamples(points, width), [points, width]);
  const message = frame ? notice : imageMessage || 'Choose an image or load archive samples.';
  const selected = chart.points[Math.min(active, chart.points.length - 1)];
  const loadMore = () => { void loader.select(position, state => { if (mounted.current) setMore(state); }, more?.status === 'error' || more?.status === 'ready'); };
  return <section className="wavelength-panel" aria-label="Wavelengths">
    <header><div><h2>Wavelengths</h2><span>{position.label} · RA {position.ra.toFixed(5)}° · Dec {position.dec.toFixed(5)}°</span></div>
      <div><button type="button" disabled={more?.status === 'loading'} onClick={loadMore}>{more?.status === 'loading' ? 'Loading more…' : more?.status === 'error' ? 'Retry samples' : more?.status === 'ready' ? 'Refresh samples' : 'Load more samples'}</button><button type="button" aria-label="Collapse wavelengths" onClick={onClose}><ChevronDown size={18} /></button></div></header>
    <div ref={plot} className="wavelength-plot"><svg viewBox={`0 0 ${width} 145`} preserveAspectRatio="none" role="img" aria-label="Measured brightness by wavelength from 0.75 to 5 micrometres; gaps are unmeasured">
      <text x="5" y="16">MJy/sr</text>{chart.points.length > 0 && <><text x="5" y="34">{chart.maximum.toPrecision(3)}</text><text x="5" y="105">{chart.minimum.toPrecision(3)}</text></>}
      <line x1="60" x2={width - 20} y1="110" y2="110" className="wavelength-axis" />
      {(width < 500 ? [.75, 2, 3, 4, 5] : [.75, 1, 2, 3, 4, 5]).map(wl => <g key={wl}><line x1={chart.x(wl)} x2={chart.x(wl)} y1="110" y2="115" className="wavelength-axis"/><text x={chart.x(wl)} y="133" textAnchor="middle">{wl} µm</text></g>)}
      {chart.points.map((point, index) => <g key={index} className="wavelength-measurement" tabIndex={0} role="button" aria-label={`${point.wavelength_um.toFixed(4)} micrometres, ${point.flux_mjy_sr.toPrecision(5)} plus or minus ${point.flux_error_mjy_sr.toPrecision(3)} MJy/sr`} onFocus={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(index); } }}>
        <title>{point.detector} · {point.utc_date} · bandwidth {point.bandwidth_um.toPrecision(3)} µm</title>
        <line x1={chart.x(point.wavelength_um)} x2={chart.x(point.wavelength_um)} y1={chart.y(point.flux_mjy_sr - point.flux_error_mjy_sr)} y2={chart.y(point.flux_mjy_sr + point.flux_error_mjy_sr)} />
        <circle cx={chart.x(point.wavelength_um)} cy={chart.y(point.flux_mjy_sr)} r="4"/><circle className="wavelength-hit" cx={chart.x(point.wavelength_um)} cy={chart.y(point.flux_mjy_sr)} r="14" />
      </g>)}
    </svg>{!chart.points.length && <p className="wavelength-empty" role="status">{more?.status === 'loading' ? 'Loading archive samples…' : message}</p>}</div>
    <footer><span role="status">{selected ? `${selected.wavelength_um.toFixed(4)} µm · ${selected.flux_mjy_sr.toPrecision(5)} ± ${selected.flux_error_mjy_sr.toPrecision(3)} MJy/sr · ${selected.utc_date || selected.detector}` : message}</span><span>{more?.status === 'error' ? more.message : 'Measured pixels only · gaps are unmeasured · dates may differ'}</span></footer>
  </section>;
}
