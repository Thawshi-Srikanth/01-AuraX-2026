import { expect, test } from 'bun:test';
import type { SpectralPoint } from '../src/services/api';
import { spectralPlotBounds } from '../src/utils/spectralPlot';

const sample: SpectralPoint = { channel_index: 0, detector: 'D1', wavelength_um: 1, bandwidth_um: .1, resolving_power: 10, flux_mjy_sr: -2, flux_error_mjy_sr: .5, snr: -4 };
test('spectral plot includes measured negative brightness and formal uncertainty', () => {
  const bounds = spectralPlotBounds([sample])!;
  expect(bounds.xMin).toBeCloseTo(.95);
  expect(bounds.xMax).toBeCloseTo(1.05);
  expect(bounds.yMin).toBeLessThan(-2.5);
  expect(bounds.yMax).toBeGreaterThan(-1.5);
});
test('one zero-valued sample remains finite without adding spectral points', () => {
  const points = [{ ...sample, flux_mjy_sr: 0, flux_error_mjy_sr: 0 }];
  const bounds = spectralPlotBounds(points)!;
  expect(bounds.yMin).toBeLessThan(0);
  expect(bounds.yMax).toBeGreaterThan(0);
  expect(points).toHaveLength(1);
});
test('missing or unusable measurements do not generate a plot', () => {
  expect(spectralPlotBounds([])).toBeNull();
  for (const changed of [{ flux_error_mjy_sr: -1 }, { flux_mjy_sr: NaN }, { wavelength_um: 0 }, { bandwidth_um: Infinity }]) expect(spectralPlotBounds([{ ...sample, ...changed }])).toBeNull();
});
