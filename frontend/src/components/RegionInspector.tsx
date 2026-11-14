import { useEffect, useRef, useState, useId } from 'react';
import { X, Circle, ExternalLink } from 'lucide-react';
import { fetchRegionAnalysis, fetchRegionCatalog, type RegionAnalysis, type RegionCatalog } from '../services/api';
import type { ObservationFrame } from '../utils/observationFrames';
import type { ImageSelection } from '../utils/imageSelection';
import './regionInspector.css';

function RegionPreview({ frame, position }: { frame: ObservationFrame; position: ImageSelection }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const { cutout } = frame;
    const patch = document.createElement('canvas'); patch.width = patch.height = 25;
    const image = patch.getContext('2d')!.createImageData(25, 25);
    for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) {
      const sx = position.x + x - 12, sy = position.y + y - 12;
      const index = sy * cutout.width + sx, offset = (y*25+x)*4;
      if (sx < 0 || sy < 0 || sx >= cutout.width || sy >= cutout.height || cutout.valid_pixels?.[index] === false || !Number.isFinite(cutout.pixels[index])) continue;
      const value = Math.round(Math.max(0, Math.min(1, cutout.pixels[index]))*255);
      image.data[offset] = image.data[offset+1] = image.data[offset+2] = value; image.data[offset+3] = 255;
    }
    patch.getContext('2d')!.putImageData(image, 0, 0);
    ctx.clearRect(0, 0, 150, 150); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(patch, 0, 0, 150, 150); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    for (const radius of [3, 5, 8]) {
      ctx.setLineDash(radius === 3 ? [] : [3, 3]);
      ctx.beginPath(); ctx.arc(75, 75, radius*6, 0, Math.PI*2); ctx.stroke();
    }
  }, [frame, position]);
  return <canvas ref={canvas} width={150} height={150} role="img" aria-label="Magnified image detail. Inner circle measures the region; dashed rings estimate the surrounding background. Transparent squares are masked or outside the image." />;
}

interface Props { position: ImageSelection; frame: ObservationFrame; centerRa: number; centerDec: number; size: number; onClose: () => void }
const number = (value: number | undefined | null, unit = '') => typeof value === 'number' && Number.isFinite(value) ? value.toPrecision(4) + (unit ? ' ' + unit : '') : 'Unavailable';
export function RegionInspector({ position, frame, centerRa, centerDec, size, onClose }: Props) {
  const heading = useId();
  const close = useRef<HTMLButtonElement>(null);
  const [analysis, setAnalysis] = useState<RegionAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<RegionCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setAnalysis(null); setError(null); setCatalog(null); setCatalogError(null);
    const timer = window.setTimeout(() => {
      fetchRegionAnalysis(frame.observation.access_url, centerRa, centerDec, size, position.ra, position.dec, controller.signal)
        .then(result => { if (current) setAnalysis(result); }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Region unavailable'); });
      fetchRegionCatalog(position.ra, position.dec, controller.signal)
        .then(result => { if (current) setCatalog(result); }).catch(reason => { if (current) setCatalogError(reason instanceof Error ? reason.message : 'Catalog unavailable'); });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [position, frame, centerRa, centerDec, size, retry]);
  const m = analysis?.measurements;
  return <section className="region-inspector" role="dialog" aria-modal="false" aria-labelledby={heading}>
    <header><div><h2 id={heading}>Region inspector</h2><p>RA {position.ra.toFixed(6)}° · Dec {position.dec.toFixed(6)}°</p></div><button ref={close} type="button" onClick={onClose} aria-label="Close region inspector"><X size={18} /></button></header>
    <div className="region-inspector-body">
      <div className="region-visual"><RegionPreview frame={frame} position={position} /><div><h3>Selected image detail</h3><p><Circle size={12} /> Region: 3 px radius</p><p>Dashed ring: local background</p><p>Checkerboard: masked or outside image</p><p>{frame.observation.detector} · {frame.observation.utc_date.replace(/Z$/, '')} UTC</p></div></div>
      <section className="region-reading" aria-label="Image interpretation"><h3>What this image supports</h3>
        {!analysis && !error && <p role="status">Measuring the selected region…</p>}
        {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value+1)}>Try again</button></div>}
        {analysis && <><p>{analysis.summary}</p>{analysis.status === 'partial' && <p className="region-muted">Some pixels were excluded. Flux covers the usable portion only.</p>}
          <dl><dt>Region brightness</dt><dd>{number(m?.mean_brightness_mjy_sr, 'MJy/sr')}</dd><dt>Surrounding background</dt><dd>{number(m?.background_mjy_sr, 'MJy/sr')}</dd><dt>Usable-aperture flux</dt><dd>{m ? `${number(m.usable_aperture_flux_mjy)} ± ${number(m.flux_error_mjy)} mJy` : 'Insufficient coverage'}</dd><dt>Signal / formal error</dt><dd>{number(m?.snr)}</dd></dl>
          <div className="region-coverage" aria-label="Usable region coverage"><span>Usable region</span><meter min="0" max="1" value={Math.min(1, analysis.aperture_coverage)} /><span>{(analysis.aperture_coverage*100).toFixed(0)}%</span></div>
          <p className="region-muted">{analysis.usable_pixels} usable · {analysis.masked_pixels} excluded pixels · {(analysis.background_coverage*100).toFixed(0)}% usable background</p>
          {analysis.wavelength_rejected_pixels > 0 && <p className="region-muted">{analysis.wavelength_rejected_pixels} pixels excluded by the local passband check.</p>}
        </>}
      </section>
      <section aria-label="Potential catalog associations"><h3>Nearby catalog objects</h3><p className="region-muted">Within 60″ of the selected point. Possible associations to investigate, not confirmed identifications. Positions have not been corrected for proper motion.</p>
        {!catalog && !catalogError && <p className="region-muted" role="status">Looking up catalog context… Measurements above are independent.</p>}
        {catalogError && <p className="region-muted" role="status">Catalog context unavailable. {catalogError}</p>}
        {catalog && <>{catalog.sources.length === 0 ? <p>No catalog records returned. This does not establish an uncataloged object.</p> : <ul className="region-candidates">{catalog.sources.slice(0, 5).map(source => <li key={source.id}><a href={'https://simbad.cds.unistra.fr/simbad/sim-id?Ident='+encodeURIComponent(source.id)} target="_blank" rel="noreferrer">{source.name}<ExternalLink size={11} /></a><span>{source.object_type_label || source.object_type} · {source.distance_arcsec.toFixed(2)}″ from point</span></li>)}</ul>}
          {catalog.sources.length > 5 && <p className="region-muted">Showing the nearest 5 of {catalog.sources.length} returned records.</p>}{catalog.truncated && <p className="region-muted">Catalog results are limited; other records may exist.</p>}
          {new Set(catalog.sources.map(source => JSON.stringify([source.ra_deg, source.dec_deg]))).size < catalog.sources.length && <p className="region-muted">Some records share reported coordinates; these are not separately resolved sources in this image.</p>}
          <p className="region-muted">{catalog.provenance} · reference positions; image match unverified</p>
        </>}
      </section>
      <details><summary>Measurement limits and provenance</summary><p>One exposure cannot establish an emission spectrum, an absorption line, an object’s physical type, or variability.</p>
        {analysis && <><p>Local passband: {analysis.wavelength_um.toFixed(4)} µm; width {analysis.bandwidth_um.toPrecision(3)} µm. This describes the observation, not an identified emission line.</p><p>{analysis.method}</p><p>{analysis.uncertainty}</p><ul>{analysis.caveats.map(text => <li key={text}>{text}</li>)}</ul><a href={analysis.source_url} target="_blank" rel="noreferrer">Archive image <ExternalLink size={11} /></a></>}
      </details>
    </div>
  </section>;
}
