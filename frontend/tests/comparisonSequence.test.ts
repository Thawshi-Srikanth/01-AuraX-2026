import { describe, expect, test } from 'bun:test';
import type { SequenceRequest, SequenceResponse, SPHERExObservation } from '../src/services/api';
import { createSequenceLoader, defaultGeneralSequence, defaultSequence, displayedSequence, sequenceKey, validateSequence } from '../src/utils/comparisonSequence';
import type { SequenceState } from '../src/utils/comparisonSequence';

const request: SequenceRequest = {
  epochs: ['01', '02', '03', '04'].map(day => ({ obs_id: 'test-' + day, detector: 'D2', utc_date: `2025-01-${day} 00:00:00`, wavelength_center_um: 1.2, access_url: `https://example.test/${day}` })),
  ra_deg: 100, dec_deg: 20, size_px: 200, stretch: 'zscale',
};
function response(req = request): SequenceResponse {
  return { status: 'success', message: 'Ready', frames: req.epochs.map(epoch => ({ epoch: { ...epoch }, pixels: Array(16).fill(.3), wavelength_um: 1.2, bandwidth_um: .04 })),
    width: 4, height: 4, registered: true, blink_ready: true, wavelength_match: true, valid_mask: Array(16).fill(true), coverage_mask: Array(16).fill(true), valid_fraction: 1, baseline_days: 3, registration_method: 'full WCS', wavelength_method: 'all-pair lookup', provenance: 'IRSA observations' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe('four-frame comparison', () => {
  test('invalid requested-position and image-quality diagnostics are rejected', () => {
    const data = response();
    data.target_pixel = { x: 1.2, y: 2.3 };
    data.frame_quality = data.frames.map((_, i) => ({ epoch_index: i, usable_pixel_count: 16, usable_fraction: 1, requested_position_usable: true, native_target_flags: 0 }));
    expect(validateSequence(request, data)).toBe(data);
    data.target_pixel.x = 4;
    expect(() => validateSequence(request, data)).toThrow('sky position');
    data.target_pixel.x = 1.2;
    data.frame_quality[2].usable_pixel_count = 3;
    expect(() => validateSequence(request, data)).toThrow('quality checks');
  });
  test('general images survive millisecond ordering differences in real FITS times', () => {
    const time = '2025-08-15T20:45:11.376Z';
    const req: SequenceRequest = { ...request, comparison_kind: 'general', epochs: request.epochs.slice(0, 2).map((epoch, i) => ({ ...epoch, utc_date: time, detector: i ? 'D6' : 'D3' })) };
    const data = response(req);
    data.comparison_kind = 'general'; data.blink_ready = false; data.wavelength_match = false;
    data.display_mask = [...data.coverage_mask];
    data.frames[0].epoch.utc_date = '2025-08-15T20:45:11.338Z';
    data.frames[1].epoch.utc_date = '2025-08-15T20:45:11.337Z';
    expect(validateSequence(req, data).frames).toHaveLength(2);
    expect(() => validateSequence({ ...req, comparison_kind: 'matched' }, data)).toThrow('chronological');
    data.frames[0].epoch.utc_date = '2025-08-15T20:45:09.000Z';
    expect(() => validateSequence(req, data)).toThrow('selected observation');
  });
  test('small angular cutouts may include an extra FITS edge pixel', () => {
    const req: SequenceRequest = { ...request, comparison_kind: 'general', size_px: 16 };
    const data = response(req);
    data.comparison_kind = 'general'; data.width = data.height = 17;
    data.valid_mask = data.coverage_mask = data.display_mask = Array(17 * 17).fill(true);
    data.frames.forEach(frame => { frame.pixels = Array(17 * 17).fill(.3); });
    expect(validateSequence(req, data).width).toBe(17);
    data.width = 257;
    expect(() => validateSequence(req, data)).toThrow('dimensions');
  });
  test('general comparison accepts simultaneous mixed-wavelength images without blink', () => {
    const req: SequenceRequest = { ...request, comparison_kind: 'general', epochs: request.epochs.map((epoch, i) => ({ ...epoch, utc_date: request.epochs[0].utc_date, detector: i % 2 ? 'D3' : 'D2' })) };
    const data = response(req);
    data.comparison_kind = 'general'; data.blink_ready = false; data.wavelength_match = false; data.baseline_days = 0;
    data.valid_mask.fill(false); data.display_mask = [...data.coverage_mask];
    data.frames.forEach((frame, i) => { frame.wavelength_um = 1.2 + i; });
    expect(validateSequence(req, data).frames).toHaveLength(4);
    data.blink_ready = true;
    expect(() => validateSequence(req, data)).toThrow();
  });
  test('general defaults distinguish detectors and avoid reprocessed duplicates', () => {
    const base = { ...request.epochs[0], wavelength_center_um: null } as SPHERExObservation;
    const reprocessed = { ...base, access_url: 'another-version' };
    const other = { ...base, detector: 'D3' };
    expect(defaultGeneralSequence([base, reprocessed, other])).toEqual([base, other]);
  });
  test('requires every selected real frame, in chronological order', () => {
    expect(validateSequence(request, response()).frames).toHaveLength(4);
    for (const change of [
      (data: SequenceResponse) => { data.frames.pop(); },
      (data: SequenceResponse) => { data.frames.reverse(); },
      (data: SequenceResponse) => { data.frames[2].epoch.obs_id = 'unrelated'; },
      (data: SequenceResponse) => { data.frames[3].epoch.utc_date = data.frames[0].epoch.utc_date; },
      (data: SequenceResponse) => { data.provenance = 'Synthetic sample'; },
      (data: SequenceResponse) => { data.registered = false; },
    ]) { const data = response(); change(data); expect(() => validateSequence(request, data)).toThrow(); }
  });
  test('checks all pairs rather than only matching each against frame one', () => {
    const data = response();
    data.frames[1].wavelength_um -= .025;
    data.frames[3].wavelength_um += .025;
    expect(() => validateSequence(request, data)).toThrow('Every frame');
  });
  test('incompatible frames may be inspected in a grid without enabling blink', () => {
    const data = response(); data.blink_ready = false; data.wavelength_match = false; data.status = 'incompatible_wavelength'; data.valid_mask.fill(false);
    expect(validateSequence(request, data).blink_ready).toBe(false);
  });
  test('invalid or uncovered pixels, missing masks and zero baseline fail closed', () => {
    for (const change of [
      (data: SequenceResponse) => { data.frames[2].pixels[0] = NaN; },
      (data: SequenceResponse) => { data.frames[3].pixels.pop(); },
      (data: SequenceResponse) => { data.coverage_mask[0] = false; },
      (data: SequenceResponse) => { data.valid_mask = []; },
      (data: SequenceResponse) => { data.baseline_days = 0; },
    ]) { const data = response(); change(data); expect(() => validateSequence(request, data)).toThrow(); }
  });
  test('late responses cannot replace a new selection, and changes hide old frames', async () => {
    const old = deferred<SequenceResponse>(), next = deferred<SequenceResponse>();
    let calls = 0, state: SequenceState | null = null;
    const loader = createSequenceLoader(() => ++calls === 1 ? old.promise : next.promise);
    const changed = { ...request, size_px: 400 };
    const a = loader.select(request, value => { state = value; });
    const b = loader.select(changed, value => { state = value; });
    next.resolve(response(changed)); await b; old.resolve(response()); await a;
    expect(displayedSequence(state, sequenceKey(changed))?.frames).toHaveLength(4);
    expect(displayedSequence(state, sequenceKey(request))).toBeNull();
    expect(displayedSequence(state, sequenceKey({ ...changed, stretch: 'log' }))).toBeNull();
  });
  test('cancelled sequence never publishes late pixels', async () => {
    const pending = deferred<SequenceResponse>(); let state: SequenceState | null = null;
    const loader = createSequenceLoader(() => pending.promise);
    const work = loader.select(request, value => { state = value; }); loader.cancel();
    pending.resolve(response()); await work;
    expect(displayedSequence(state, sequenceKey(request))).toBeNull();
  });
  test('defaults spread four frames across available dates; fewer dates stay honest', () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({ ...request.epochs[0], obs_id: String(i), utc_date: `2025-01-${String(i + 1).padStart(2, '0')} 00:00:00` } as SPHERExObservation));
    expect(defaultSequence(pool).map(value => value.obs_id)).toEqual(['0', '3', '6', '9']);
    expect(defaultSequence(pool.slice(0, 3))).toHaveLength(3);
    expect(defaultSequence([pool[0], pool[0]])).toHaveLength(1);
    expect(defaultSequence([])).toEqual([]);
  });
});
