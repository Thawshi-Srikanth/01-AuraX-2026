import { expect, test } from 'bun:test';
import { chartSamples, mergeSamples } from '../src/utils/wavelengthChart';
import type { SpectralPoint } from '../src/services/api';
const point = { obs_id: 'fixture', source_url: 'https://example.test/one.fits?size=1', detector: 'D1', wavelength_um: 1.2, flux_mjy_sr: -2, flux_error_mjy_sr: .5 } as SpectralPoint;

test('full wavelength axis remains fixed while brightness includes negative flux and uncertainty', () => {
  const chart = chartSamples([point], 390);
  expect(chart.x(.75)).toBe(60);
  expect(chart.x(5)).toBe(370);
  expect(chart.minimum).toBeLessThan(-2.5);
  expect(chart.maximum).toBeGreaterThan(-1.5);
});
test('missing, invalid and out-of-range data cannot become plotted measurements', () => {
  expect(chartSamples([point, {...point, flux_mjy_sr: NaN}, {...point, wavelength_um: 6}, {...point, flux_error_mjy_sr: -1}]).points).toEqual([point]);
  expect(chartSamples([]).points).toEqual([]);
});
test('identical products from different cutout sizes merge, but reprocessed files stay distinct', () => {
  const same = { ...point, source_url: 'https://example.test/one.fits?size=2' };
  const other = { ...point, source_url: 'https://example.test/reprocessed.fits' };
  expect(mergeSamples([point, same, other])).toHaveLength(2);
});
