import type { SpectrumResponse } from '../services/api';
import { DETECTOR_COLORS } from '../tokens/colors';
import { spectralPlotBounds } from '../utils/spectralPlot';

export function SavedSpectrum({ spectrum }: { spectrum: SpectrumResponse }) {
  const points = spectrum.spectral_points;
  const bounds = spectralPlotBounds(points);
  if (!bounds) return <p role="alert">These measurements cannot be plotted because their calibration values are incomplete.</p>;
  const x = (value: number) => 78 + (value - bounds.xMin) / (bounds.xMax - bounds.xMin) * 610;
  const y = (value: number) => 190 - (value - bounds.yMin) / (bounds.yMax - bounds.yMin) * 170;
  return <div className="space-y-4">
    <svg viewBox="0 0 720 240" role="img" aria-label={`Measured spectral samples for ${spectrum.target_name}`} className="w-full max-h-72">
      <title>Observed surface brightness and formal pixel uncertainty</title>
      <desc>Each point is a measured nearest-pixel sample. Vertical bars show variance-derived uncertainty. Horizontal bars show channel bandwidth. Samples are not connected or interpolated.</desc>
      {Array.from({ length: 5 }, (_, i) => {
        const value = bounds.xMin + (bounds.xMax - bounds.xMin) * i / 4;
        return <g key={'x' + i}><line x1={x(value)} x2={x(value)} y1="20" y2="190" stroke="#1C2029" /><text x={x(value)} y="208" fill="#888E9B" fontSize="10" textAnchor="middle">{value.toFixed(3)}</text></g>;
      })}
      {Array.from({ length: 4 }, (_, i) => {
        const value = bounds.yMin + (bounds.yMax - bounds.yMin) * i / 3;
        return <g key={'y' + i}><line x1="78" x2="688" y1={y(value)} y2={y(value)} stroke="#1C2029" /><text x="70" y={y(value) + 3} fill="#888E9B" fontSize="10" textAnchor="end">{value.toPrecision(3)}</text></g>;
      })}
      {points.map((point, index) => <g key={index} stroke={DETECTOR_COLORS[point.detector] || '#FFFFFF'} fill={DETECTOR_COLORS[point.detector] || '#FFFFFF'}><title>{point.detector}: {point.wavelength_um.toFixed(4)} µm · {point.flux_mjy_sr.toPrecision(5)} ± {point.flux_error_mjy_sr.toPrecision(3)} MJy/sr · {point.utc_date || 'Date unavailable'}</title><line x1={x(point.wavelength_um - point.bandwidth_um / 2)} x2={x(point.wavelength_um + point.bandwidth_um / 2)} y1={y(point.flux_mjy_sr)} y2={y(point.flux_mjy_sr)} opacity=".5" /><line x1={x(point.wavelength_um)} x2={x(point.wavelength_um)} y1={y(point.flux_mjy_sr - point.flux_error_mjy_sr)} y2={y(point.flux_mjy_sr + point.flux_error_mjy_sr)} /><circle cx={x(point.wavelength_um)} cy={y(point.flux_mjy_sr)} r="3.5" /></g>)}
      <text x="385" y="232" textAnchor="middle" fill="#888E9B" fontSize="11">Wavelength (µm)</text><text transform="translate(15 110) rotate(-90)" textAnchor="middle" fill="#888E9B" fontSize="11">Surface brightness (MJy/sr)</text>
    </svg>
    <p className="text-xs text-[#888E9B]">{spectrum.message} {points.length} measured {points.length === 1 ? 'sample' : 'samples'}; this is not a complete source spectrum. Dates can differ, and the measurements include background light.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Measured spectral samples and original archive files</caption><thead className="text-[#888E9B]"><tr><th className="py-2">Detector</th><th>Wavelength</th><th>Brightness ± uncertainty</th><th>UTC date</th><th>Source</th></tr></thead><tbody>{points.map((point, index) => <tr key={index} className="border-t border-[#1C2029]"><td className="py-2">{point.detector}</td><td>{point.wavelength_um.toFixed(4)} µm</td><td>{point.flux_mjy_sr.toPrecision(5)} ± {point.flux_error_mjy_sr.toPrecision(3)} MJy/sr</td><td>{point.utc_date?.replace('T', ' ').replace(/Z$/, '') || 'Not provided'}</td><td>{point.source_url?.startsWith('https://') && <a className="underline" href={point.source_url} target="_blank" rel="noreferrer">FITS ↗</a>}</td></tr>)}</tbody></table></div>
    {!!spectrum.excluded_observations?.length && <details className="text-xs text-[#888E9B]"><summary>{spectrum.excluded_observations.length} observations excluded</summary><ul>{spectrum.excluded_observations.map((item, i) => <li key={i}>{item.obs_id} · {item.detector}: {item.reason.replace(/_/g, ' ')}</li>)}</ul></details>}
    <details className="text-xs text-[#888E9B]"><summary>Measurement method and limitations</summary><p className="mt-2">{spectrum.method || 'Nearest-pixel surface brightness.'} {spectrum.uncertainty}</p><ul>{spectrum.caveats?.map(caveat => <li key={caveat}>{caveat}</li>)}</ul><p className="mt-2">{spectrum.provenance}</p></details>
  </div>;
}
