import { describe, expect, test } from 'bun:test';
import { createFrameLoader, displayedFrame, frameRequestKey, type FrameRequest, type FrameState } from '../src/utils/observationFrames';
import type { CutoutResponse } from '../src/services/api';

// Deliberately tiny test payloads; these are not astronomical observations.
const request = (id: string, ra = 100): FrameRequest => ({
  observation: { obs_id: id, detector: 'D1', band_name: 'D1', mjd_start: 60000, utc_date: '2023-02-25 00:00:00', date_only: '2023-02-25', wavelength_min_um: 1, wavelength_max_um: 1.1, wavelength_center_um: 1.05, exptime_sec: 1, access_url: 'https://example.test/' + id },
  ra, dec: 20, stretch: 'zscale', size: 32,
});
const image = (value: number): CutoutResponse => ({
  width: 2, height: 1, pixels: [value, value], raw_flux: [value, value], bunit: 'MJy/sr',
  min_flux_mjy_sr: value, max_flux_mjy_sr: value, mean_flux_mjy_sr: value,
  stretch_applied: 'zscale', wcs: {crval1: null,crval2: null,crpix1: null,crpix2: null,cdelt1: null,cdelt2: null,cunit1: 'deg',cunit2: 'deg'},
  source: 'Identity test fixture', status: 'success', message: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('selected observation identity', () => {
  test('a slow older response cannot replace the new image or its date', async () => {
    const a = deferred<CutoutResponse>();
    const b = deferred<CutoutResponse>();
    const loader = createFrameLoader(url => url.endsWith('/a') ? a.promise : b.promise);
    let state: FrameState | null = null;
    const publish = (next: FrameState) => { state = next; };
    const first = loader.select(request('a'), publish);
    const second = loader.select(request('b'), publish);
    b.resolve(image(.2)); await second;
    a.resolve(image(.1)); await first;
    const frame = displayedFrame(state, frameRequestKey(request('b')));
    expect(frame?.observation.obs_id).toBe('b');
    expect(frame?.cutout.pixels[0]).toBe(.2);
    expect(displayedFrame(state, frameRequestKey(request('a')))).toBeNull();
  });
  test('an older failure cannot replace a newer successful frame', async () => {
    const old = deferred<CutoutResponse>();
    const loader = createFrameLoader(url => url.endsWith('/a') ? old.promise : Promise.resolve(image(.2)));
    let state: FrameState | null = null;
    const first = loader.select(request('a'), next => { state = next; });
    await loader.select(request('b'), next => { state = next; });
    old.reject(new Error('Old failure')); await first;
    expect(displayedFrame(state, frameRequestKey(request('b')))?.observation.obs_id).toBe('b');
  });
  test('target, stretch, or FOV changes immediately hide the previous frame', async () => {
    const loader = createFrameLoader(async () => image(.1));
    let state: FrameState | null = null;
    await loader.select(request('a'), next => { state = next; });
    for (const changed of [request('a', 101), {...request('a'), stretch:'linear'}, {...request('a'), size:400}]) {
      expect(displayedFrame(state, frameRequestKey(changed))).toBeNull();
    }
  });
  test('a missing URL never requests a demo image', async () => {
    let calls = 0;
    const loader = createFrameLoader(async () => { calls++; return image(.1); });
    const missing = request('a'); missing.observation.access_url = '';
    let state: FrameState | null = null;
    await loader.select(missing, next => { state = next; });
    expect(calls).toBe(0);
    expect(displayedFrame(state, frameRequestKey(missing))).toBeNull();
    expect(state?.status).toBe('error');
  });
  test('both labelled samples and legacy samples marked success are rejected', async () => {
    for (const sample of [{...image(.1),status:'sample_fallback' as const}, {...image(.1),source:'Calibrated Sample Reference'}]) {
      const loader = createFrameLoader(async () => sample);
      let state: FrameState | null = null;
      await loader.select(request('a'), next => { state = next; });
      expect(state?.status).toBe('error');
      expect(displayedFrame(state, frameRequestKey(request('a')))).toBeNull();
    }
  });
  test('a failed new selection clears the previously displayed frame and can retry', async () => {
    let fail = false;
    const loader = createFrameLoader(async () => { if (fail) throw new Error('Unavailable'); return image(.1); });
    let state: FrameState | null = null;
    const publish = (next: FrameState) => { state = next; };
    await loader.select(request('a'), publish);
    fail = true; await loader.select(request('b'), publish);
    expect(state?.status).toBe('error');
    expect(displayedFrame(state, frameRequestKey(request('a')))).toBeNull();
    fail = false; await loader.select(request('b'), publish);
    expect(displayedFrame(state, frameRequestKey(request('b')))?.observation.obs_id).toBe('b');
  });
  test('cancellation prevents publishing after unmount', async () => {
    const pending = deferred<CutoutResponse>();
    const loader = createFrameLoader(() => pending.promise);
    const published: FrameState[] = [];
    const load = loader.select(request('a'), state => published.push(state));
    loader.cancel(); pending.resolve(image(.1)); await load;
    expect(published.map(state => state.status)).toEqual(['loading']);
  });
});
