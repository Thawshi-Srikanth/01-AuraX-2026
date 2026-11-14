import { describe, expect, test } from 'bun:test';
import type { MatchRequest, MatchResponse } from '../src/services/api';
import { createMatchLoader, matchKey, recommendedObservations, validateMatches } from '../src/utils/comparisonMatches';
import type { MatchState } from '../src/utils/comparisonMatches';

const request: MatchRequest = { ra_deg: 100, dec_deg: 20, size_px: 200 };
function response(count = 4): MatchResponse {
  const observations = Array.from({ length: count }, (_, i) => ({ obs_id: String(i), detector: 'D2', band_name: 'SPHEREx-D2', mjd_start: 60000 + i * 60, utc_date: `2025-0${i+1}-01 00:00:00`, date_only: `2025-0${i+1}-01`, wavelength_min_um: 1.1, wavelength_max_um: 1.64, wavelength_center_um: 1.37, local_wavelength_um: 1.2 + i * .005, local_bandwidth_um: .04, exptime_sec: 100, access_url: `https://example.test/${i}.fits` }));
  return { status: 'success', message: 'Search incomplete', groups: [{ id: 'D2-1234567890123456', detector: 'D2', wavelength_um: 1.21, observations, recommended_ids: observations.map(item => item.obs_id), baseline_days: (count - 1) * 60 }], candidates: 12, checked: count, pending: 12-count, failed: 0, complete: false, metadata_complete: false, can_continue: true, auto_continue: true, limited: false, provenance: 'IRSA SPHEREx WCS-WAVE' };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('compatible-date discovery', () => {
  test('uses local calibration instead of broad archive band midpoint', () => {
    const data = validateMatches(response());
    expect(data.groups[0].observations[0].wavelength_center_um).toBe(1.37);
    expect(data.groups[0].observations[0].local_wavelength_um).toBe(1.2);
    expect(recommendedObservations(data.groups[0]).map(item => item.obs_id)).toEqual(['0','1','2','3']);
  });
  test('rejects transitive-only wavelength chains and missing calibration', () => {
    const data = response(); data.groups[0].observations.forEach((item,i) => { item.local_wavelength_um = 1.2 + i * .025; });
    expect(() => validateMatches(data)).toThrow('incompatible');
    const missing = response(); missing.groups[0].observations[0].local_bandwidth_um = NaN;
    expect(() => validateMatches(missing)).toThrow();
  });
  test('never labels pending or failed calibration as a completed search', () => {
    expect(() => validateMatches({ ...response(), complete: true })).toThrow();
    const noMatches = { ...response(), groups: [], checked: 0, pending: 11, failed: 1 };
    expect(validateMatches(noMatches).complete).toBe(false);
    expect(() => validateMatches({ ...noMatches, complete: true, metadata_complete: true })).toThrow();
  });
  test('rejects missing recommendations, duplicate exposures and synthetic substitutions', () => {
    const data = response(); data.groups[0].recommended_ids[3] = 'absent';
    expect(() => validateMatches(data)).toThrow();
    const duplicate = response(); duplicate.groups[0].observations[1].obs_id = '0';
    expect(() => validateMatches(duplicate)).toThrow();
    expect(() => validateMatches({ ...response(), provenance: 'Synthetic sample' })).toThrow();
  });
  test('publishes a usable pair immediately, then upgrades to four checked dates', async () => {
    const states: MatchState[] = []; const requests: MatchRequest[] = [];
    const loader = createMatchLoader(async req => { requests.push(req); return response(requests.length === 1 ? 2 : 4); });
    await loader.select(request, value => states.push(value));
    expect(states[1].data?.groups[0].recommended_ids).toHaveLength(2);
    expect(states[1].searching).toBe(true);
    expect(states.at(-1)?.data?.groups[0].recommended_ids).toHaveLength(4);
    expect(states.at(-1)?.searching).toBe(false);
    expect(requests.map(item => !!item.advance)).toEqual([false,true]);
  });
  test('bounds automatic batches and stops when progress stalls', async () => {
    let calls = 0;
    const loader = createMatchLoader(async () => { calls++; return response(2); });
    await loader.select(request, () => {});
    expect(calls).toBe(2);
    calls = 0;
    const changing = createMatchLoader(async () => { calls++; return { ...response(2), candidates:12+calls, pending:10+calls }; });
    await changing.select(request, () => {});
    expect(calls).toBe(3);
  });
  test('returning to a checked target does not restart automatic downloads', async () => {
    let calls=0;
    const loader=createMatchLoader(async()=>{calls++;return {...response(2),auto_continue:false};});
    await loader.select(request,()=>{});
    expect(calls).toBe(1);
  });
  test('cancellation hides late matching results for an old target', async () => {
    const old = deferred<MatchResponse>(); let state: MatchState | null = null;
    const loader = createMatchLoader(async req => req.ra_deg === 100 ? old.promise : response());
    const pending = loader.select(request, value => { state = value; });
    await loader.select({ ...request, ra_deg: 101 }, value => { state = value; });
    old.resolve(response()); await pending;
    expect(state?.key).toBe(matchKey({ ...request, ra_deg: 101 }));
  });
  test('archive interruptions retain partial matches and stop automatic work', async () => {
    let calls = 0; let state: MatchState | null = null;
    const loader = createMatchLoader(async () => { calls++; return { ...response(2), status:'partial' }; });
    await loader.select(request, value => { state = value; });
    expect(calls).toBe(1); expect(state?.data?.groups).toHaveLength(1); expect(state?.searching).toBe(false);
  });
});
