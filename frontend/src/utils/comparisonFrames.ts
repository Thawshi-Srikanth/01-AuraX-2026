import type { CompareRequest, CompareResponse } from '../services/api';

export type ComparisonState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'ready'; data: CompareResponse };

export const comparisonKey = (request: CompareRequest) => JSON.stringify(request);
export function displayedComparison(state: ComparisonState | null, key: string | null) {
  return key && state?.key === key && state.status === 'ready' ? state.data : null;
}

export function validateComparison(request: CompareRequest, data: CompareResponse) {
  if (data.status === 'error') throw new Error(data.message || 'The selected images could not be compared.');
  if (!['success', 'incompatible_wavelength'].includes(data.status)) throw new Error('Unsupported comparison response.');
  if (data.registered !== true || /sample|synthetic|simulat/i.test(data.provenance)) throw new Error('This response is not a registered pair of archive observations.');
  for (const epoch of ['epoch_a', 'epoch_b'] as const) {
    const selected = request[epoch], returned = data[epoch];
    if (!returned || selected.obs_id !== returned.obs_id || selected.detector !== returned.detector || selected.access_url !== returned.access_url) {
      throw new Error('The returned image does not match the selected observation.');
    }
    const utc = (value: string) => Date.parse(value.replace(' ', 'T').replace(/Z$/, '') + 'Z');
    if (!Number.isFinite(utc(selected.utc_date)) || !Number.isFinite(utc(returned.utc_date)) || Math.abs(utc(selected.utc_date) - utc(returned.utc_date)) > 1000) throw new Error('The returned observation date does not match the selection.');
  }
  const pixels = data.width * data.height;
  if (!Number.isInteger(data.width) || !Number.isInteger(data.height) || pixels <= 0 || [data.pixels_a, data.pixels_b, data.valid_mask, data.coverage_mask].some(values => values?.length !== pixels)) throw new Error('The comparison image or mask is incomplete.');
  if ([data.pixels_a, data.pixels_b].some(values => !values.every(Number.isFinite)) || [data.valid_mask, data.coverage_mask].some(values => !values.every(value => typeof value === 'boolean'))) throw new Error('Invalid comparison pixels or masks.');
  if (data.blink_ready && (!data.wavelength_match || !(data.baseline_days != null && data.baseline_days > 0) || data.valid_mask.filter(Boolean).length < 16)) throw new Error('The wavelength checks did not pass for blinking.');
  return data;
}

export function createComparisonLoader(fetchPair: (request: CompareRequest, signal: AbortSignal) => Promise<CompareResponse>) {
  let generation = 0;
  let controller: AbortController | null = null;
  const cancel = () => { generation++; controller?.abort(); };
  return {
    cancel,
    async select(request: CompareRequest, publish: (state: ComparisonState) => void) {
      cancel();
      const ticket = generation, key = comparisonKey(request);
      controller = new AbortController();
      publish({ key, status: 'loading' });
      try {
        const result = await fetchPair(request, controller.signal);
        if (ticket === generation) publish({ key, status: 'ready', data: validateComparison(request, result) });
      } catch (error) {
        if (ticket === generation) publish({ key, status: 'error', message: error instanceof Error ? error.message : 'Comparison unavailable.' });
      }
    },
  };
}
