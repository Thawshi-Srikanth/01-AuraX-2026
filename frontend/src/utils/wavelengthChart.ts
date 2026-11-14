import type { SpectralPoint } from '../services/api';
export function chartSamples(points: SpectralPoint[], width = 1000) {
  const valid = points.filter(p => [p.wavelength_um, p.flux_mjy_sr, p.flux_error_mjy_sr].every(Number.isFinite) && p.flux_error_mjy_sr >= 0 && p.wavelength_um >= .75 && p.wavelength_um <= 5);
  const lo = Math.min(...valid.map(p => p.flux_mjy_sr - p.flux_error_mjy_sr));
  const hi = Math.max(...valid.map(p => p.flux_mjy_sr + p.flux_error_mjy_sr));
  const pad = valid.length ? Math.max((hi - lo) * .15, Math.abs(hi) * .01, 1e-6) : 1;
  const minimum = valid.length ? lo - pad : 0, maximum = valid.length ? hi + pad : 1;
  return { points: valid, minimum, maximum,
    x: (wavelength: number) => 60 + (wavelength - .75) / 4.25 * (width - 80),
    y: (flux: number) => 105 - (flux - minimum) / (maximum - minimum) * 85 };
}
export function mergeSamples(points: SpectralPoint[]) {
  const unique = new Map<string, SpectralPoint>();
  for (const point of points) unique.set(JSON.stringify([point.source_url?.split('?')[0] || point.obs_id, point.detector]), point);
  return [...unique.values()].sort((a, b) => a.wavelength_um - b.wavelength_um);
}
