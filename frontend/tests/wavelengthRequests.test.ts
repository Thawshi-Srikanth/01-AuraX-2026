import { describe, expect, test } from 'bun:test';
import { canvasPixel, imagePosition } from '../src/utils/wavelengthPosition';
import { createWavelengthLoader, type WavelengthState } from '../src/utils/wavelengthRequests';
import type { CutoutResponse, SpectrumResponse } from '../src/services/api';

// Small identity fixtures only; these are not scientific observations.
const image = { width: 2, height: 2, wcs: { ra_grid: [359.99, 0.01, 100, null], dec_grid: [-1, 0, 1, null] } } as unknown as CutoutResponse;
const spectrum = { spectral_points: [] } as unknown as SpectrumResponse;
const position = { ra: 100, dec: 20, label: 'Fixture position' };
const deferred = () => { let resolve!: (value: SpectrumResponse) => void; const promise = new Promise<SpectrumResponse>(done => { resolve = done; }); return { promise, resolve }; };

describe('image position wavelengths', () => {
  test('reads the exact WCS grid including RA wrap, without linear sky approximations', () => {
    expect(imagePosition(image, 0.2, 0.9)?.ra).toBe(359.99);
    expect(imagePosition(image, 1.2, 0.9)?.ra).toBe(0.01);
    expect(imagePosition(image, 0.2, 1.9)?.dec).toBe(1);
    expect(imagePosition(image, 1, 1)).toBeNull();
    expect(imagePosition(image, -1, 0)).toBeNull();
    expect(imagePosition(image, 2, 0)).toBeNull();
  });
  test('maps rotated, zoomed and panned screen coordinates back to the image', () => {
    // Image coordinate (60,40), around image center (50,50), then rotate 90deg.
    const pixel = canvasPixel(340, 230, 600, 400, 100, 100, 2, 20, 10, 90);
    expect(pixel.x).toBeCloseTo(60);
    expect(pixel.y).toBeCloseTo(40);
  });
  test('missing sky calibration cannot open a fabricated position', () => {
    expect(imagePosition({ ...image, wcs: {} } as CutoutResponse, 0, 0)).toBeNull();
  });
});

describe('wavelength request lifecycle', () => {
  test('aborts the previous position and ignores its late response', async () => {
    const a = deferred(), b = deferred();
    const signals: AbortSignal[] = [];
    const loader = createWavelengthLoader((_name, ra, _dec, signal) => { signals.push(signal); return ra === 100 ? a.promise : b.promise; }, new Map());
    const states: WavelengthState[] = [];
    const first = loader.select(position, state => states.push(state));
    const second = loader.select({ ...position, ra: 101 }, state => states.push(state));
    expect(signals[0].aborted).toBe(true);
    b.resolve(spectrum); await second;
    a.resolve({ ...spectrum, target_name: 'Stale result' }); await first;
    expect(states.filter(state => state.status === 'ready')).toEqual([{ status: 'ready', spectrum }]);
  });
  test('reopening recent coordinates reuses results; explicit retry refreshes', async () => {
    let calls = 0;
    const loader = createWavelengthLoader(async () => { calls++; return spectrum; }, new Map());
    await loader.select(position, () => {});
    await loader.select({ ...position, label: 'Different label' }, () => {});
    expect(calls).toBe(1);
    await loader.select(position, () => {}, true);
    expect(calls).toBe(2);
  });
  test('closing stops publication and aborts the network request', async () => {
    const pending = deferred();
    let signal!: AbortSignal;
    const loader = createWavelengthLoader((_name, _ra, _dec, value) => { signal = value; return pending.promise; }, new Map());
    const states: WavelengthState[] = [];
    const running = loader.select(position, state => states.push(state));
    loader.cancel(); pending.resolve(spectrum); await running;
    expect(signal.aborted).toBe(true);
    expect(states).toEqual([{ status: 'loading' }]);
  });
  test('archive failure becomes a usable error state', async () => {
    const loader = createWavelengthLoader(async () => { throw new Error('No usable samples'); }, new Map());
    const states: WavelengthState[] = [];
    await loader.select(position, state => states.push(state));
    expect(states.at(-1)).toEqual({ status: 'error', message: 'No usable samples' });
  });
});
