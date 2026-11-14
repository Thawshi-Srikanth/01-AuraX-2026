import { afterEach, expect, test } from 'bun:test';
import { exportSpectrumCsv, exportSpectrumIpac, exportSpectrumVOTable } from '../src/utils/collections';
import type { SpectrumResponse } from '../src/services/api';
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});
test('all exports preserve measured sample counts, units and missing S/N without inventing channels', async () => {
  const blobs: Blob[] = [];
  URL.createObjectURL = ((blob: Blob) => { blobs.push(blob); return 'blob:export-test'; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => {};
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} },
  } });
  // Explicit unit-test fixture; never a displayed or archived measurement.
  const spectrum: SpectrumResponse = {
    target_name: 'Export fixture', ra_deg: 10, dec_deg: 20, total_channels: 1,
    spectral_points: [{ channel_index: 0, detector: 'D3', wavelength_um: 2.2, bandwidth_um: .04,
      resolving_power: 55, flux_mjy_sr: -.2, flux_error_mjy_sr: 0, snr: NaN }],
    spectral_features: [], detector_bands: [], mean_flux_mjy_sr: -.2, peak_flux_mjy_sr: -.2,
    status: 'success', provenance: 'Unit-test fixture',
  };
  exportSpectrumCsv(spectrum); exportSpectrumIpac(spectrum); exportSpectrumVOTable(spectrum);
  const [csv, ipac, xml] = await Promise.all(blobs.map(b => b.text()));
  expect(csv).toContain('sample_index,detector');
  expect(csv.split('\n').filter(l => l && !l.startsWith('#')).length).toBe(2);
  expect(ipac).toContain('|sample |detector|');
  expect(xml).toContain('<FIELD name="sample" datatype="int"/>');
  expect(xml.match(/<TR>/g)?.length).toBe(1);
  for (const text of [csv, ipac, xml]) {
    expect(text).toContain('MJy/sr'); expect(text).toContain('-0.2000');
    expect(text).not.toContain('NaN'); expect(text).not.toContain('102-Channel');
  }
});
