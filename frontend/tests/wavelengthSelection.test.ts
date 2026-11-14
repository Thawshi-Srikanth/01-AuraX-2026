import { expect, test } from 'bun:test';
import type { SpectralPoint, SPHERExObservation } from '../src/services/api';
import { filterSpectralSamples, nearestSpectralSample, observationForSample, sampleForObservation } from '../src/utils/wavelengthSelection';
// Explicit selection fixtures, not astronomical observations.
const sample = (detector: string, obs_id = 'shared', artifact_id = detector): SpectralPoint => ({
  obs_id, artifact_id, detector, utc_date: '2025-08-15T00:00:00Z', channel_index: detector === 'D3' ? 0 : 1,
  wavelength_um: detector === 'D3' ? 2.2 : 4.9, bandwidth_um: .04, resolving_power: 55,
  flux_mjy_sr: 1, flux_error_mjy_sr: .1, snr: 10,
});
const observation = (detector: string, obs_id = 'shared', artifact_id = detector): SPHERExObservation => ({
  obs_id, artifact_id, detector, utc_date: '2025-08-15T00:00:00Z', date_only: '2025-08-15',
  band_name: detector, mjd_start: 60000, wavelength_min_um: 2, wavelength_max_um: 5,
  wavelength_center_um: null, exptime_sec: null, access_url: `https://example.test/${artifact_id}`,
});
test('shared observation IDs never cross detectors', () => {
  const points = [sample('D3'), sample('D6')];
  expect(sampleForObservation(points, observation('D6'))?.detector).toBe('D6');
  expect(observationForSample([observation('D3'), observation('D6')], points[1])?.detector).toBe('D6');
});
test('processing products with shared time and detector retain their own identity', () => {
  expect(sampleForObservation([sample('D3', 'shared', 'version-a')], observation('D3', 'shared', 'version-b'))).toBeNull();
});
test('an unmeasured exposure has no invented nearest measurement', () => {
  expect(sampleForObservation([sample('D3')], observation('D3', 'another-date'))).toBeNull();
  expect(observationForSample([observation('D3', 'another-date')], sample('D3'))).toBeNull();
});
test('band and UTC date filters apply to measurements as well as images', () => {
  const points = [sample('D3'), sample('D6')];
  expect(filterSpectralSamples(points, 'D3', 'ALL')).toEqual([points[0]]);
  expect(filterSpectralSamples(points, 'ALL', '2025-08-16')).toEqual([]);
  expect(filterSpectralSamples(points, 'ALL', '2025-08-15')).toEqual(points);
});
test('empty filters cannot silently choose an unrelated global sample', () => {
  expect(nearestSpectralSample([], 2.2)).toBeNull();
  expect(nearestSpectralSample([sample('D6')], 2.2)?.detector).toBe('D6');
});
test('same-wavelength samples on distinct dates keep separate exposure identities', () => {
  const first = sample('D3', 'epoch-a', 'a'), second = sample('D3', 'epoch-b', 'b');
  expect(observationForSample([observation('D3', 'epoch-a', 'a'), observation('D3', 'epoch-b', 'b')], second)?.obs_id).toBe('epoch-b');
  expect(sampleForObservation([first, second], observation('D3', 'epoch-b', 'b'))).toBe(second);
});
