export interface Health {
  status: 'healthy';
  service: 'AURAx API';
  version: string;
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/backend').replace(/\/+$/, '');

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch(`${apiBase}/health`, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Backend is unavailable.');
  const data: unknown = await response.json();
  if (
    typeof data !== 'object' || data === null ||
    !('status' in data) || data.status !== 'healthy' ||
    !('service' in data) || data.service !== 'AURAx API' ||
    !('version' in data) || typeof data.version !== 'string' ||
    data.version.length === 0
  ) throw new Error('Backend returned an invalid health response.');
  return { status: 'healthy', service: 'AURAx API', version: data.version };
}


export type TargetQuery = { kind: 'name'; name: string } | { kind: 'coordinates'; ra: string; dec: string };
export interface TargetResult {
  canonical_name: string;
  object_type: string;
  coordinates: { ra_deg: number; dec_deg: number; frame: 'ICRS'; epoch: string | null };
  provenance: string;
  source_url: string | null;
  coordinate_reference: string | null;
  retrieved_at: string | null;
  cached: boolean;
}

const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
export function targetParameters(query: TargetQuery): URLSearchParams {
  if (query.kind === 'name') {
    const name = query.name.trim();
    if (!name || name.length > 200 || Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Enter an object name or catalog identifier, up to 200 characters.');
    return new URLSearchParams({ target: name });
  }
  const ra = query.ra.trim(), dec = query.dec.trim();
  if (!numberPattern.test(ra) || !numberPattern.test(dec) ||
    !Number.isFinite(Number(ra)) || Number(ra) < 0 || Number(ra) >= 360 ||
    !Number.isFinite(Number(dec)) || Number(dec) < -90 || Number(dec) > 90) {
    throw new Error('Enter RA from 0 to less than 360 and Dec from −90 to +90, in decimal degrees.');
  }
  return new URLSearchParams({ ra: String(Number(ra)), dec: String(Number(dec)) });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const optionalText = (value: unknown): value is string | null => value === null || text(value);

export async function resolveTarget(query: TargetQuery, signal?: AbortSignal): Promise<TargetResult> {
  const params = targetParameters(query);
  const response = await fetch(`${apiBase}/api/resolve?${params}`, {
    signal, headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok) {
    const message: Record<number, string> = {
      400: 'Check the target name or coordinates.',
      404: 'No matching object was found in SIMBAD. Check the name or use coordinates.',
      409: 'Use a more specific catalog identifier.',
      422: 'Check the target name or coordinate ranges.',
      502: 'The catalog returned unusable target data. Try again later.',
      503: 'The resolver is unavailable. Try again later.',
    };
    throw new Error(message[response.status] || 'The target could not be resolved. Try again later.');
  }
  const invalid = () => new Error('The resolver returned invalid target data.');
  let data: unknown;
  try { data = await response.json(); } catch { throw invalid(); }
  if (!record(data) || !text(data.canonical_name) || !text(data.object_type) || !text(data.provenance) ||
    typeof data.cached !== 'boolean' || !optionalText(data.source_url) || !optionalText(data.coordinate_reference) ||
    !optionalText(data.retrieved_at) || !record(data.coordinates)) throw invalid();
  const coordinates = data.coordinates;
  if (typeof coordinates.ra_deg !== 'number' || !Number.isFinite(coordinates.ra_deg) || coordinates.ra_deg < 0 || coordinates.ra_deg >= 360 ||
    typeof coordinates.dec_deg !== 'number' || !Number.isFinite(coordinates.dec_deg) || coordinates.dec_deg < -90 || coordinates.dec_deg > 90 ||
    coordinates.frame !== 'ICRS' || !optionalText(coordinates.epoch)) throw invalid();
  if (data.source_url !== null) {
    try {
      const source = new URL(data.source_url);
      if (source.protocol !== 'https:' || source.username || source.password ||
        !['simbad.cds.unistra.fr', 'simbad.cfa.harvard.edu'].includes(source.hostname)) throw invalid();
    } catch { throw invalid(); }
  }
  if (query.kind === 'name' && (!data.source_url || !data.retrieved_at || data.provenance !== 'CDS / SIMBAD via TAP')) throw invalid();
  if (query.kind === 'coordinates' && (coordinates.ra_deg !== Number(params.get('ra')) ||
    coordinates.dec_deg !== Number(params.get('dec')) || data.source_url !== null)) throw invalid();
  return {
    canonical_name: data.canonical_name, object_type: data.object_type,
    coordinates: { ra_deg: coordinates.ra_deg, dec_deg: coordinates.dec_deg, frame: 'ICRS', epoch: coordinates.epoch },
    provenance: data.provenance, source_url: data.source_url,
    coordinate_reference: data.coordinate_reference, retrieved_at: data.retrieved_at, cached: data.cached,
  };
}
