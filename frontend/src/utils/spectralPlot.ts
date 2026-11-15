import type { SpectralPoint } from '../services/api';

export function spectralPlotBounds(points: SpectralPoint[]) {
  if (!points.length || points.some(point => !Number.isFinite(point.wavelength_um) || point.wavelength_um <= 0 || !Number.isFinite(point.bandwidth_um) || point.bandwidth_um <= 0 || !Number.isFinite(point.flux_mjy_sr) || !Number.isFinite(point.flux_error_mjy_sr) || point.flux_error_mjy_sr < 0)) return null;
  const xMin = Math.min(...points.map(point => point.wavelength_um - point.bandwidth_um / 2));
  const xMax = Math.max(...points.map(point => point.wavelength_um + point.bandwidth_um / 2));
  const minimum = Math.min(...points.map(point => point.flux_mjy_sr - point.flux_error_mjy_sr));
  const maximum = Math.max(...points.map(point => point.flux_mjy_sr + point.flux_error_mjy_sr));
  const padding = Math.max((maximum - minimum) * .12, Math.abs(maximum) * .05, 1e-6);
  return { xMin, xMax, yMin: minimum - padding, yMax: maximum + padding };
}
