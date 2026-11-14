import type { SpectrumResponse } from '../services/api';
import type { WavelengthPosition } from './wavelengthPosition';

type State = { status: 'loading' } | { status: 'ready'; spectrum: SpectrumResponse } | { status: 'error'; message: string };
export type WavelengthState = State;
const recent = new Map<string, { time: number; spectrum: SpectrumResponse }>();

// One request at a time per sheet; stale archive responses never overwrite a new point.
export function createWavelengthLoader(fetcher: (name: string, ra: number, dec: number, signal: AbortSignal) => Promise<SpectrumResponse>, cache = recent) {
  let generation = 0;
  let controller: AbortController | null = null;
  const cancel = () => { generation++; controller?.abort(); };
  return { cancel, async select(position: WavelengthPosition, publish: (state: State) => void, refresh = false) {
    cancel();
    const ticket = generation;
    const key = JSON.stringify([position.ra, position.dec]);
    const hit = cache.get(key);
    if (!refresh && hit && Date.now() - hit.time < 300000) { publish({ status: 'ready', spectrum: hit.spectrum }); return; }
    publish({ status: 'loading' });
    controller = new AbortController();
    try {
      const spectrum = await fetcher(position.label, position.ra, position.dec, controller.signal);
      if (ticket !== generation) return;
      cache.delete(key);
      cache.set(key, { time: Date.now(), spectrum });
      if (cache.size > 32) cache.delete(cache.keys().next().value!);
      publish({ status: 'ready', spectrum });
    } catch (error) {
      if (ticket === generation) publish({ status: 'error', message: error instanceof Error ? error.message : 'Wavelength samples unavailable.' });
    }
  } };
}
