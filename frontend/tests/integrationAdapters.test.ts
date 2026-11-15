import { afterEach, expect, test } from 'bun:test';
import { adaptMatches, angularSize, compareSequence, fetchCutout, fetchObservations, fetchTargetSpectrum, findComparisonMatches, fetchCatalogSources } from '../src/services/api';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function stub(bodies: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!bodies.length) throw new Error('Unexpected request');
    return new Response(JSON.stringify(bodies.shift()), { status: 200 });
  }) as typeof fetch;
  return calls;
}
test('unknown observation wavelengths and partial archive metadata remain usable', async () => {
  const observations = [{ wavelength_center_um: null }];
  const calls = stub([{ status: 'partial', observations, truncated: true }]);
  expect((await fetchObservations(269.4520769586187, 4.69)).observations).toEqual(observations);
  expect(calls[0].url).toContain('269.4520769586187');
});
test('cutouts translate angular size, full WCS, source and masks without changing physical values', async () => {
  const calls = stub([{ status: 'success', width: 2, height: 1, pixels: [.5, null], raw_flux: [14, 99], valid_pixels: [true, false], bunit: 'MJy/sr', source_url: 'archive', spatial_wcs_header: 'SIP', wcs: { ra_grid: [1, 2], dec_grid: [3, 4] } }]);
  const image = await fetchCutout('https://archive/image', 'zscale', 10, 20, 200);
  expect(new URL(calls[0].url, 'http://local').searchParams.get('size_deg')).toBe(String(angularSize(200)));
  expect(image.raw_flux).toEqual([14, 99]);
  expect(Number.isNaN(image.pixels[1])).toBe(true);
  expect(image.valid_pixels).toEqual([true, false]);
  expect(image.wcs.spatial_wcs_header).toBe('SIP');
  expect(image.source).toBe('archive');
});
test('no usable pixels is a visible error', async () => {
  stub([{ status: 'no_usable_pixels', message: 'All pixels masked' }]);
  await expect(fetchCutout('url')).rejects.toThrow('All pixels masked');
});
test('spectra contain measured samples only and retain a missing S/N', async () => {
  stub([{ spectral_points: [{ obs_id: 'real', detector: 'D3', wavelength_um: 2, bandwidth_um: .04, resolving_power: 50, flux_mjy_sr: -3, flux_error_mjy_sr: 0, snr: null }], status: 'partial' }]);
  const result = await fetchTargetSpectrum('Target', 1, 2);
  expect(result.total_channels).toBe(1);
  expect(result.spectral_features).toEqual([]);
  expect(result.mean_flux_mjy_sr).toBe(-3);
  expect(Number.isNaN(result.spectral_points[0].snr)).toBe(true);
  expect(result.spectral_points[0].obs_id).toBe('real');
});
test('empty spectrum does not create zero flux or model channels', async () => {
  stub([{ spectral_points: [], message: 'No usable data' }]);
  await expect(fetchTargetSpectrum('Target', 1, 2)).rejects.toThrow('No usable data');
});
test('saved spectrum retrieval is bounded and forwards cancellation and coordinates', async () => {
  const calls = stub([{ spectral_points: [{ detector: 'D3', wavelength_um: 2, bandwidth_um: .04, resolving_power: 50, flux_mjy_sr: 1, flux_error_mjy_sr: .2 }], status: 'partial' }]);
  const controller = new AbortController();
  await fetchTargetSpectrum('Saved target', 12.123456789, -4.5, controller.signal, 6);
  const params = new URL(calls[0].url, 'http://test').searchParams;
  expect(params.get('limit')).toBe('6');
  expect(params.get('ra')).toBe('12.123456789');
  expect(params.get('dec')).toBe('-4.5');
  expect(calls[0].init?.signal).toBe(controller.signal);
  await expect(fetchTargetSpectrum('Saved target', 1, 2, undefined, 7)).rejects.toThrow('1 and 6');
  expect(calls).toHaveLength(1);
});
const epoch = (n: number) => ({ obs_id: `obs${n}`, detector: 'D3', access_url: `https://archive/${n}`, utc_date: `2025-01-0${n}T00:00:00Z`, mjd_start: 60000 + n, target_wavelength_um: 2, target_bandwidth_um: .04 });
const matches = { status: 'matches', message: 'Checked', candidate_count: 4, checked_count: 2, failed_count: 1, pending_count: 1, metadata_truncated: false, metadata_rejected_count: 0, pairs_truncated: false, search_complete: false, can_continue: true,
  checks: [1, 2].map(n => ({ artifact_id: `a${n}`, status: 'verified', epoch: epoch(n) })),
  pairs: [{ artifact_id_a: 'a1', artifact_id_b: 'a2', detector: 'D3', baseline_days: 1 }] };
test('actual verified pairs produce stable groups and truthful progress', () => {
  const result = adaptMatches(matches);
  expect(result.checked + result.failed + result.pending).toBe(4);
  expect(result.groups[0].observations.map(o => o.obs_id)).toEqual(['obs1', 'obs2']);
  expect(result.groups[0].id).toMatch(/^D3-[a-f0-9]{16}$/);
  expect(result.complete).toBe(false);
});
test('matching uses background jobs and translates the legacy request', async () => {
  const calls = stub([{ job_id: 'j1' }, { status: 'completed', result: matches }]);
  await findComparisonMatches({ ra_deg: 10, dec_deg: 20, size_px: 200 });
  expect(JSON.parse(calls[0].init!.body as string)).toEqual({ ra: 10, dec: 20, candidate_limit: 24, advance: false, retry_failed: false });
  expect(calls[1].url).toEndWith('/jobs/j1');
});
const selected = [1, 2].map(n => ({ ...epoch(n), wavelength_center_um: 2 }));
test('registered sequences send URLs and preserve epoch identity and missing-pixel masks', async () => {
  const calls = stub([{ status: 'ready', blink_ready: true, epochs: selected, frames: [0, 1].map(epoch_index => ({ epoch_index, pixels: [.5, null] })), valid_mask: [true, false], target_wavelength_match: true, matched_fraction: .5 }]);
  const result = await compareSequence({ epochs: selected, ra_deg: 1, dec_deg: 2, size_px: 200, stretch: 'zscale' });
  expect(JSON.parse(calls[0].init!.body as string).access_urls).toEqual(selected.map(e => e.access_url));
  expect(JSON.parse(calls[0].init!.body as string).size_deg).toBeLessThanOrEqual(.25);
  expect(result.frames[0].pixels).toEqual([.5, 0]);
  expect(result.valid_mask).toEqual([true, false]);
});
test('incompatible epochs cannot render as a prepared sequence', async () => {
  stub([{ status: 'incompatible_wavelength', message: 'Wavelength mismatch', frames: [] }]);
  await expect(compareSequence({ epochs: selected, ra_deg: 1, dec_deg: 2, size_px: 200, stretch: 'zscale' })).rejects.toThrow('Wavelength mismatch');
});
test('general comparison retains real image pixels when wavelength matching fails', async () => {
  const calls = stub([{ status: 'ready', comparison_kind: 'general', blink_ready: false, epochs: selected, frames: [0, 1].map(epoch_index => ({ epoch_index, pixels: [.5, null] })), valid_mask: [false, false], display_mask: [true, false], coverage_mask: [true, false], target_wavelength_match: false, matched_fraction: 0 }]);
  const result = await compareSequence({ epochs: selected, ra_deg: 1, dec_deg: 2, size_px: 200, stretch: 'zscale', comparison_kind: 'general' });
  expect(JSON.parse(calls[0].init!.body as string).comparison_kind).toBe('general');
  expect(result.frames[0].pixels).toEqual([.5, 0]);
  expect(result.blink_ready).toBe(false);
  expect(result.display_mask).toEqual([true, false]);
});
test('catalog uses the exact image SIP header and invents no photometry', async () => {
  const calls = stub([{ status: 'success', sources: [{ id: 's', ra_deg: 1, dec_deg: 2 }] }, { pixels: [[3, 4]], image_match_verified: false }]);
  const result = await fetchCatalogSources(1, 2, 3, 10, 10, '', '', { crval1: null, crval2: null, crpix1: null, crpix2: null, cdelt1: null, cdelt2: null, cunit1: null, cunit2: null, spatial_wcs_header: 'full SIP' });
  expect(JSON.parse(calls[1].init!.body as string).spatial_wcs_header).toBe('full SIP');
  expect(result.sources[0].pixel_x).toBe(3);
  expect(result.sources[0].mag_v).toBeNull();
  expect(result.sources[0].brightness_rank).toBe(0);
});

test('three dates are grouped only when every actual pair was verified', () => {
  const checks = [1, 2, 3].map(n => ({ artifact_id: `a${n}`, status: 'verified', epoch: epoch(n) }));
  const chain = { ...matches, checks, pairs: [...matches.pairs, { ...matches.pairs[0], artifact_id_a: 'a2', artifact_id_b: 'a3' }] };
  expect(adaptMatches(chain).groups.every(g => g.observations.length === 2)).toBe(true);
  const clique = { ...chain, pairs: [...chain.pairs, { ...matches.pairs[0], artifact_id_a: 'a1', artifact_id_b: 'a3' }] };
  expect(adaptMatches(clique).groups[0].observations.length).toBe(3);
});
test('cancelling a client search also cancels its server job', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    if (url.endsWith('/jobs')) return Response.json({ job_id: 'cancel-me' });
    if (url.endsWith('/cancel')) return Response.json({ status: 'cancelled' });
    controller.abort(new Error('Stopped'));
    throw controller.signal.reason;
  }) as typeof fetch;
  await expect(findComparisonMatches({ ra_deg: 1, dec_deg: 2, size_px: 200 }, controller.signal)).rejects.toThrow('Stopped');
  expect(calls.some(url => url.endsWith('/jobs/cancel-me/cancel'))).toBe(true);
});


test('quality-warning image values render while analysis eligibility remains false', async () => {
  stub([{status:'success',width:2,height:1,pixels:[.4,null],raw_flux:[5,null],valid_pixels:[false,false],display_valid_pixels:[true,false],display_warning_pixel_count:1,wcs:{},source_url:'archive'}]);
  const image = await fetchCutout('url');
  expect(image.pixels[0]).toBe(.4);
  expect(image.valid_pixels).toEqual([false,false]);
  expect(image.display_valid_pixels).toEqual([true,false]);
  expect(Number.isNaN(image.pixels[1])).toBe(true);
});
