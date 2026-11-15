import type { SequenceRequest, SequenceResponse, SPHERExObservation } from '../services/api';

export const observationIdentity = (observation: { obs_id: string; detector: string; access_url?: string | null }) => JSON.stringify([observation.obs_id, observation.detector, observation.access_url]);
export const sequenceKey = (request: SequenceRequest) => JSON.stringify(request);
export type SequenceState = { key: string; status: 'loading' | 'error'; message?: string } | { key: string; status: 'ready'; data: SequenceResponse };
export const displayedSequence = (state: SequenceState | null, key: string | null) => state?.key === key && state.status === 'ready' ? state.data : null;
const timestamp = (date: string) => Date.parse(date.replace(' ', 'T').replace(/Z$/, '') + 'Z');

export function defaultSequence(pool: SPHERExObservation[]) {
  const distinct = pool.filter((value, index) => pool.findIndex(other => other.utc_date === value.utc_date) === index);
  const count = Math.min(4, distinct.length);
  return Array.from({ length: count }, (_, i) => distinct[count === 1 ? 0 : Math.round(i * (distinct.length - 1) / (count - 1))]);
}

export function defaultGeneralSequence(pool: SPHERExObservation[]) {
  const selected: SPHERExObservation[] = [];
  const seen = new Set<string>();
  for (const image of pool) {
    const identity = JSON.stringify([image.obs_id, image.detector]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push(image);
  }
  const count = Math.min(4, selected.length);
  return Array.from({ length: count }, (_, i) => selected[count === 1 ? 0 : Math.round(i * (selected.length - 1) / (count - 1))]);
}

export function validateSequence(request: SequenceRequest, response: SequenceResponse) {
  const general = request.comparison_kind === 'general';
  if (general && response.comparison_kind !== 'general') throw new Error('General comparison was not confirmed by the server.');
  if (response.status === 'error') throw new Error(response.message || 'The observations could not be prepared.');
  if (!['success', 'incompatible_wavelength'].includes(response.status) || response.registered !== true || /sample|synthetic|simulat/i.test(response.provenance)) throw new Error('A registered sequence of real archive observations is required.');
  const epochs = [...request.epochs].sort((a, b) => timestamp(a.utc_date) - timestamp(b.utc_date));
  if (response.frames?.length !== epochs.length || epochs.length < 2 || epochs.length > 4) throw new Error('The sequence does not contain all selected frames.');
  const pixels = response.width * response.height;
  // size_px selects an angular field, not an exact returned FITS pixel count.
  if (!Number.isInteger(response.width) || !Number.isInteger(response.height) || response.width <= 0 || response.height <= 0 || response.width > 256 || response.height > 256) throw new Error('Invalid image dimensions.');
  for (const [index, frame] of response.frames.entries()) {
    const selected = epochs[index];
    if (observationIdentity(frame.epoch) !== observationIdentity(selected) || !Number.isFinite(timestamp(frame.epoch.utc_date)) || Math.abs(timestamp(frame.epoch.utc_date) - timestamp(selected.utc_date)) > 1000) throw new Error('A returned frame does not match its selected observation.');
    if (!general && index > 0 && timestamp(frame.epoch.utc_date) <= timestamp(response.frames[index - 1].epoch.utc_date)) throw new Error('Frame dates must be distinct and chronological.');
    if (frame.pixels?.length !== pixels || !frame.pixels.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Incomplete image pixels.');
    if (!(frame.wavelength_um > 0) || !Number.isFinite(frame.wavelength_um) || !(frame.bandwidth_um > 0) || !Number.isFinite(frame.bandwidth_um)) throw new Error('Missing frame wavelength calibration.');
  }
  if ([response.valid_mask, response.coverage_mask].some(mask => mask?.length !== pixels || !mask.every(value => typeof value === 'boolean'))) throw new Error('Incomplete comparison masks.');
  if (response.valid_mask.some((valid, i) => valid && !response.coverage_mask[i])) throw new Error('Blink pixels must have common quality coverage.');
  if (general && (response.display_mask?.length !== pixels || response.display_mask.some((valid, i) => typeof valid !== 'boolean' || (valid && !response.coverage_mask[i])) || response.display_mask.filter(Boolean).length < 16)) throw new Error('General comparison requires common image coverage.');
  if (response.target_pixel && (![response.target_pixel.x, response.target_pixel.y].every(Number.isFinite) || response.target_pixel.x < -.5 || response.target_pixel.y < -.5 || response.target_pixel.x >= response.width - .5 || response.target_pixel.y >= response.height - .5)) throw new Error('Invalid requested sky position.');
  if (response.frame_quality && (response.frame_quality.length !== epochs.length || response.frame_quality.some((check, i) => check.epoch_index !== i || !Number.isInteger(check.usable_pixel_count) || check.usable_pixel_count < 0 || check.usable_pixel_count > pixels || !Number.isFinite(check.usable_fraction) || Math.abs(check.usable_fraction - check.usable_pixel_count / pixels) > 1e-9 || typeof check.requested_position_usable !== 'boolean' || !Number.isInteger(check.native_target_flags) || check.native_target_flags < 0))) throw new Error('Invalid image quality checks.');
  if (response.blink_ready) {
    if (!response.wavelength_match || response.status !== 'success' || !(response.baseline_days > 0) || response.valid_mask.filter(Boolean).length < 16) throw new Error('Sequence wavelength checks did not pass.');
    for (const frame of response.frames) for (const other of response.frames) {
      if (frame.epoch.detector !== other.epoch.detector || Math.abs(frame.wavelength_um - other.wavelength_um) + .002 > Math.min(frame.bandwidth_um, other.bandwidth_um) + 1e-12) throw new Error('Every frame must match in wavelength.');
    }
  }
  return response;
}

export function createSequenceLoader(fetchSequence: (request: SequenceRequest, signal: AbortSignal) => Promise<SequenceResponse>) {
  let generation = 0;
  let controller: AbortController | null = null;
  const cancel = () => { generation++; controller?.abort(); };
  return {
    cancel,
    async select(request: SequenceRequest, publish: (state: SequenceState) => void) {
      cancel();
      const ticket = generation, key = sequenceKey(request);
      controller = new AbortController();
      publish({ key, status: 'loading' });
      try {
        const data = await fetchSequence(request, controller.signal);
        if (ticket === generation) publish({ key, status: 'ready', data: validateSequence(request, data) });
      } catch (error) {
        if (ticket === generation) publish({ key, status: 'error', message: error instanceof Error ? error.message : 'Comparison unavailable.' });
      }
    },
  };
}
