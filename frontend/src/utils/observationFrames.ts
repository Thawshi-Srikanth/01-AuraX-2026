import type { CutoutResponse, SPHERExObservation } from '../services/api';

export interface FrameRequest {
  observation: SPHERExObservation;
  ra: number;
  dec: number;
  stretch: string;
  size: number;
}
export interface ObservationFrame {
  observation: SPHERExObservation;
  cutout: CutoutResponse;
}
export type FrameState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'ready'; frame: ObservationFrame };

export function frameRequestKey(request: FrameRequest): string {
  const { observation, ra, dec, stretch, size } = request;
  return JSON.stringify([observation.obs_id, observation.detector, observation.access_url, ra, dec, stretch, size]);
}

export function displayedFrame(state: FrameState | null, key: string | null): ObservationFrame | null {
  return key && state?.key === key && state.status === 'ready' ? state.frame : null;
}

type CutoutLoader = (url: string, stretch: string, ra: number, dec: number, size: number, signal: AbortSignal) => Promise<CutoutResponse>;

// A frame and its metadata are published together. Late requests cannot replace the current selection.
export function createFrameLoader(fetchCutout: CutoutLoader) {
  const cache = new Map<string, ObservationFrame>();
  let generation = 0;
  let controller: AbortController | null = null;
  function cancel() {
    generation += 1;
    controller?.abort();
  }
  return {
    cancel,
    invalidate(key: string) { cache.delete(key); },
    async select(request: FrameRequest, publish: (state: FrameState) => void) {
      cancel();
      const ticket = generation;
      const key = frameRequestKey(request);
      const cached = cache.get(key);
      if (cached) {
        publish({ key, status: 'ready', frame: cached });
        return;
      }
      publish({ key, status: 'loading' });
      controller = new AbortController();
      try {
        if (!request.observation.access_url?.trim()) throw new Error('This observation has no image download URL. Choose another observation.');
        const cutout = await fetchCutout(request.observation.access_url, request.stretch, request.ra, request.dec, request.size, controller.signal);
        if (ticket !== generation) return;
        if (cutout.status !== 'success' || /sample|reference image/i.test(cutout.source)) {
          throw new Error(cutout.status === 'sample_fallback' || /sample/i.test(cutout.source)
            ? 'A reference sample cannot replace the selected observation.'
            : cutout.message || 'The selected observation could not be loaded.');
        }
        if (cutout.width <= 0 || cutout.height <= 0 || cutout.pixels.length !== cutout.width * cutout.height) {
          throw new Error('The selected image is incomplete. Try again or choose another observation.');
        }
        const frame = { observation: request.observation, cutout };
        if (cutout.width <= 800) cache.set(key, frame);
        if (cache.size > 12) cache.delete(cache.keys().next().value!);
        publish({ key, status: 'ready', frame });
      } catch (error) {
        if (ticket === generation) publish({ key, status: 'error', message: error instanceof Error ? error.message : 'The selected image could not be loaded.' });
      }
    },
  };
}
