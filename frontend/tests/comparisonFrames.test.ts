import { describe, expect, test } from 'bun:test';
import type { CompareRequest, CompareResponse } from '../src/services/api';
import { comparisonKey, createComparisonLoader, displayedComparison, validateComparison } from '../src/utils/comparisonFrames';
import type { ComparisonState } from '../src/utils/comparisonFrames';

const request: CompareRequest = {
  epoch_a: { obs_id: 'test-A', detector: 'D2', utc_date: '2025-01-01 00:00:00', wavelength_center_um: 1.2, access_url: 'https://example.test/a' },
  epoch_b: { obs_id: 'test-B', detector: 'D2', utc_date: '2025-07-01 00:00:00', wavelength_center_um: 1.2, access_url: 'https://example.test/b' },
  ra_deg: 100, dec_deg: 20, size_px: 200, stretch: 'zscale',
};
function response(req = request): CompareResponse {
  return { epoch_a: { ...req.epoch_a }, epoch_b: { ...req.epoch_b }, status: 'success', message: null,
    width: 4, height: 4, pixels_a: Array(16).fill(.1), pixels_b: Array(16).fill(.2), pixels_diff: [], metrics: null, wcs: null,
    wavelength_match: true, wavelength_diff_percent: 0, registered: true, blink_ready: true,
    valid_mask: Array(16).fill(true), coverage_mask: Array(16).fill(true), valid_fraction: 1, baseline_days: 181,
    wavelength_a_um: 1.2, wavelength_b_um: 1.2, bandwidth_a_um: .03, bandwidth_b_um: .03,
    registration_method: 'reproject_interp', wavelength_method: 'WCS-WAVE', provenance: 'IRSA observations',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('comparison identity and blink guards', () => {
  test('rejects sample substitution and legacy registration claims', () => {
    expect(() => validateComparison(request, { ...response(), provenance: 'Synthetic sample' })).toThrow();
    expect(() => validateComparison(request, { ...response(), registered: false })).toThrow();
  });
  test('rejects a different image or date even with matching dimensions', () => {
    const wrong = response(); wrong.epoch_b.obs_id = 'other';
    expect(() => validateComparison(request, wrong)).toThrow();
    const date = response(); date.epoch_a.utc_date = '2024-01-01 00:00:00';
    expect(() => validateComparison(request, date)).toThrow();
  });
  test('missing or invalid masks and pixels cannot enable blink', () => {
    expect(() => validateComparison(request, { ...response(), valid_mask: [] })).toThrow();
    const invalid = response(); invalid.pixels_a[0] = NaN;
    expect(() => validateComparison(request, invalid)).toThrow();
  });
  test('wavelength mismatch and zero time interval cannot enable blink', () => {
    expect(() => validateComparison(request, { ...response(), wavelength_match: false })).toThrow();
    expect(() => validateComparison(request, { ...response(), baseline_days: 0 })).toThrow();
    const sideBySide = { ...response(), status: 'incompatible_wavelength' as const, blink_ready: false, wavelength_match: false, valid_mask: Array(16).fill(false) };
    expect(validateComparison(request, sideBySide)).toBe(sideBySide);
  });
  test('slower older responses never replace a newer pair', async () => {
    const old = deferred<CompareResponse>(), next = deferred<CompareResponse>();
    let calls = 0, state: ComparisonState | null = null;
    const loader = createComparisonLoader(() => (++calls === 1 ? old.promise : next.promise));
    const changed = { ...request, size_px: 400 };
    const a = loader.select(request, value => { state = value; });
    const b = loader.select(changed, value => { state = value; });
    next.resolve(response(changed)); await b;
    old.resolve(response()); await a;
    expect(displayedComparison(state, comparisonKey(changed))?.width).toBe(4);
    expect(displayedComparison(state, comparisonKey(request))).toBeNull();
  });
  test('changes to target, dates, stretch or field immediately hide old data', () => {
    const state: ComparisonState = { key: comparisonKey(request), status: 'ready', data: response() };
    for (const change of [{ ra_deg: 101 }, { size_px: 400 }, { stretch: 'linear' }, { epoch_b: { ...request.epoch_b, obs_id: 'next' } }]) {
      expect(displayedComparison(state, comparisonKey({ ...request, ...change }))).toBeNull();
    }
  });
  test('errors clear the old pair and cancellation ignores late failure', async () => {
    const wait = deferred<CompareResponse>();
    let state: ComparisonState | null = null;
    const loader = createComparisonLoader(() => wait.promise);
    const work = loader.select(request, value => { state = value; });
    expect(displayedComparison(state, comparisonKey(request))).toBeNull();
    loader.cancel(); wait.reject(new Error('late')); await work;
    expect(state?.status).toBe('loading');
  });
});
