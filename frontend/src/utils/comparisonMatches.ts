import type { MatchGroup, MatchRequest, MatchResponse } from '../services/api';

export const matchKey = (request: MatchRequest) => JSON.stringify([request.ra_deg, request.dec_deg, request.from_date || '', request.to_date || '', request.size_px]);
export interface MatchState { key: string; searching: boolean; data?: MatchResponse; error?: string }

export function validateMatches(response: MatchResponse) {
  if (response.status === 'error' || response.status === 'busy') throw new Error(response.message);
  if (!['success', 'partial'].includes(response.status) || /sample|synthetic|simulat/i.test(response.provenance)) throw new Error('Real archive wavelength checks are required.');
  if (!Array.isArray(response.groups) || response.groups.length > 24) throw new Error('Invalid wavelength groups.');
  if ([response.checked, response.candidates, response.pending, response.failed].some(value => !Number.isInteger(value) || value < 0) || response.checked + response.pending + response.failed !== response.candidates) throw new Error('Invalid matching progress.');
  if (response.complete && (!response.metadata_complete || response.pending > 0 || response.failed > 0 || response.limited)) throw new Error('An incomplete search cannot be labelled complete.');
  for (const group of response.groups) {
    if (!group.id || !Number.isFinite(group.wavelength_um) || group.wavelength_um <= 0 || !Number.isFinite(group.baseline_days) || group.baseline_days <= 0 || !Array.isArray(group.observations) || group.observations.length < 2 || group.observations.length > 64) throw new Error('Invalid matched observations.');
    const ids = new Set(group.observations.map(item => item.obs_id));
    if (ids.size !== group.observations.length || group.recommended_ids.length < 2 || group.recommended_ids.length > 4 || new Set(group.recommended_ids).size !== group.recommended_ids.length || group.recommended_ids.some(id => !ids.has(id))) throw new Error('Matching recommendations must contain distinct real dates.');
    for (const item of group.observations) {
      if (item.detector !== group.detector || !item.access_url || !Number.isFinite(item.mjd_start) || !Number.isFinite(Date.parse(item.utc_date.replace(' ', 'T').replace(/Z$/, '') + 'Z')) || !Number.isFinite(item.local_wavelength_um) || item.local_wavelength_um <= 0 || !Number.isFinite(item.local_bandwidth_um) || item.local_bandwidth_um <= 0) throw new Error('Missing local wavelength calibration.');
      for (const other of group.observations) {
        if (Math.abs(item.local_wavelength_um - other.local_wavelength_um) + .002 > Math.min(item.local_bandwidth_um, other.local_bandwidth_um) + 1e-12) throw new Error('The group contains incompatible wavelengths.');
      }
    }
  }
  return response;
}

export function recommendedObservations(group: MatchGroup) {
  return group.observations.filter(item => group.recommended_ids.includes(item.obs_id)).sort((a, b) => a.mjd_start - b.mjd_start);
}

export function createMatchLoader(fetchMatches: (request: MatchRequest, signal: AbortSignal) => Promise<MatchResponse>) {
  let generation = 0;
  let controller: AbortController | null = null;
  const cancel = () => { generation++; controller?.abort(); };
  return {
    cancel,
    async select(request: MatchRequest, publish: (state: MatchState) => void) {
      cancel();
      const ticket = generation, key = matchKey(request);
      controller = new AbortController();
      publish({ key, searching: true });
      let previous = '', data: MatchResponse | undefined;
      try {
        // At most three bounded batches automatically. More work is explicit.
        for (let batch = 0; batch < 3; batch++) {
          data = validateMatches(await fetchMatches({ ...request, advance: request.advance || batch > 0, retry_failed: !!request.retry_failed && batch === 0 }, controller.signal));
          if (ticket !== generation) return;
          const progress = JSON.stringify([data.checked, data.candidates, data.failed]);
          const done = !data.auto_continue || data.complete || data.limited || data.status === 'partial' || data.groups[0]?.recommended_ids.length === 4 || batch === 2 || progress === previous;
          publish({ key, data, searching: !done });
          if (done) return;
          previous = progress;
        }
      } catch (error) {
        if (ticket === generation) publish({ key, data, searching: false, error: error instanceof Error ? error.message : 'Matching search unavailable.' });
      }
    },
  };
}
