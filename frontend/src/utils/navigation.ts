import type { NavigationTab } from '../tokens/colors';
import type { ResolvedTarget } from '../services/api';

export const ROUTES: Record<NavigationTab, string> = { Home: '/', Explore: '/sky', Docs: '/docs', Observations: '/images', Compare: '/compare', Wavelengths: '/wavelengths', Collections: '/saved' };
export type Preferences = Record<string, Record<string, Record<string, unknown>>>;
export interface AnalysisSession { version: 1; target: ResolvedTarget; preferences: Preferences }
export const SESSION_KEY = 'aurax.analysis.v1';
export const targetIdentity = (target: ResolvedTarget) => JSON.stringify([target.coordinates.ra_deg, target.coordinates.dec_deg]);
export const isAnalysis = (tab: NavigationTab) => ['Observations', 'Compare', 'Wavelengths'].includes(tab);
const viewName = (tab: NavigationTab) => ({ Observations: 'images', Compare: 'compare', Wavelengths: 'wavelengths' }[tab as 'Observations' | 'Compare' | 'Wavelengths']);
const detectorValid = (value: unknown) => typeof value === 'string' && /^(All|D[1-6])$/.test(value);
const decimal = (value: string | null) => value != null && value.trim() !== '' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value));

export const DEFAULT_TARGET: ResolvedTarget = {
  query: "Barnard's Star",
  canonical_name: "NAME Barnard's star",
  object_type: "Sky position",
  coordinates: {
    ra_deg: 269.45208,
    dec_deg: 4.69339,
    ra_hms: "17h 57m 48.50s",
    dec_dms: "+04° 41' 36.2\"",
    frame: "ICRS",
    epoch: "Not specified",
  },
  proper_motion: null,
  aliases: [],
  provenance: "Example starting coordinates; not catalog verified",
};

// Sexagesimal formatting helper for custom coordinates
function formatCoords(raDeg: number, decDeg: number): { raStr: string; decStr: string } {
  const normRa = ((raDeg % 360) + 360) % 360;
  const totalHours = normRa / 15;
  const h = Math.floor(totalHours);
  const remM = (totalHours - h) * 60;
  const m = Math.floor(remM);
  const s = ((remM - m) * 60).toFixed(1);
  const raStr = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.padStart(4, '0')}s`;

  const sign = decDeg >= 0 ? '+' : '-';
  const absDec = Math.abs(decDeg);
  const d = Math.floor(absDec);
  const remArcmin = (absDec - d) * 60;
  const arcmin = Math.floor(remArcmin);
  const arcsec = Math.round((remArcmin - arcmin) * 60);
  const decStr = `${sign}${String(d).padStart(2, '0')}° ${String(arcmin).padStart(2, '0')}' ${String(arcsec).padStart(2, '0')}"`;

  return { raStr, decStr };
}


export const emptySession = (): AnalysisSession => ({ version: 1, target: DEFAULT_TARGET, preferences: {} });
function metadata(value: unknown, depth = 0): boolean {
  if (depth > 7) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 4096;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as object);
  return entries.length <= 64 && entries.every(([key, item]) => key.length <= 200 && key !== '__proto__' && metadata(item, depth + 1));
}
export function validSession(value: unknown): value is AnalysisSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as AnalysisSession;
  const t = candidate.target;
  return candidate.version === 1 && !!t && typeof t.query === 'string' && typeof t.canonical_name === 'string'
    && t.query.length <= 200 && t.canonical_name.length <= 200 && !!t.coordinates
    && Number.isFinite(t.coordinates.ra_deg) && t.coordinates.ra_deg >= 0 && t.coordinates.ra_deg < 360
    && Number.isFinite(t.coordinates.dec_deg) && Math.abs(t.coordinates.dec_deg) <= 90
    && typeof t.provenance === 'string' && typeof t.object_type === 'string'
    && ['ra_hms', 'dec_dms', 'frame', 'epoch'].every(field => typeof (t.coordinates as unknown as Record<string, unknown>)[field] === 'string')
    && Array.isArray(t.aliases) && t.aliases.length <= 100 && t.aliases.every(alias => typeof alias === 'string')
    && (t.proper_motion === null || (!!t.proper_motion && ['pm_ra_mas_yr', 'pm_dec_mas_yr'].every(field => { const item = (t.proper_motion as unknown as Record<string, unknown>)[field]; return item === null || typeof item === 'number' && Number.isFinite(item); })))
    && !!candidate.preferences && metadata(candidate.preferences)
    && Object.keys(candidate.preferences).length <= 8;
}
export function readSession(storage?: Pick<Storage, 'getItem'>): AnalysisSession {
  try { const raw = storage?.getItem(SESSION_KEY); if (raw && raw.length < 250000) { const value: unknown = JSON.parse(raw); if (validSession(value)) return value; } } catch { /* Private browsing or malformed storage: keep navigation usable. */ }
  return emptySession();
}
export function preference<T>(session: AnalysisSession, targetKey: string, view: string, field: string, fallback: T): T {
  const value = session.preferences[targetKey]?.[view]?.[field];
  function compatible(example: unknown, candidate: unknown): boolean {
    if (example === null) return candidate === null || typeof candidate === 'string';
    if (typeof example !== typeof candidate || candidate === undefined) return false;
    if (typeof example === 'object' && example) return !!candidate && !Array.isArray(candidate) && Object.entries(example).every(([key, item]) => compatible(item, (candidate as Record<string, unknown>)[key]));
    return typeof candidate !== 'number' || Number.isFinite(candidate);
  }
  return compatible(fallback, value) ? value as T : fallback;
}
export function setPreference(session: AnalysisSession, targetKey: string, view: string, field: string, value: unknown): AnalysisSession {
  if (JSON.stringify(session.preferences[targetKey]?.[view]?.[field]) === JSON.stringify(value)) return session;
  const preferences = { ...session.preferences, [targetKey]: { ...session.preferences[targetKey], [view]: { ...session.preferences[targetKey]?.[view], [field]: value } } };
  const keys = Object.keys(preferences);
  if (keys.length > 8) delete preferences[keys.find(key => key !== targetKey)!];
  return { ...session, preferences };
}
function observationName(value: unknown): string {
  if (typeof value !== 'string') return '';
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0]; } catch { /* Bare observation IDs are used in shared URLs. */ }
  return value;
}
export function matchesObservation(observation: { obs_id: string; detector: string }, id: string): boolean {
  try { const parts: unknown = JSON.parse(id); if (Array.isArray(parts)) return parts[0] === observation.obs_id && parts[1] === observation.detector; } catch { /* Legacy/bare IDs are scoped by the detector filter. */ }
  return id === observation.obs_id;
}
function observationDetector(value: unknown): string {
  try { const parts: unknown = JSON.parse(String(value)); if (Array.isArray(parts) && /^D[1-6]$/.test(String(parts[1]))) return String(parts[1]); } catch { /* No detector embedded. */ }
  return '';
}
export function routeUrl(tab: NavigationTab, session: AnalysisSession): string {
  if (!isAnalysis(tab)) return ROUTES[tab];
  const t = session.target;
  const params = new URLSearchParams({ target: t.query || t.canonical_name, ra: String(t.coordinates.ra_deg), dec: String(t.coordinates.dec_deg) });
  const values = session.preferences[targetIdentity(t)]?.[viewName(tab)] || {};
  const put = (key: string, value: unknown) => { if ((typeof value === 'string' && value) || (typeof value === 'number' && Number.isFinite(value))) params.set(key, String(value)); };
  put('detector', values.detector);
  put('size', values.size); put('stretch', values.stretch);
  if (tab === 'Observations') {
    const selection = values.selection as { id?: string } | undefined;
    const range = (values.dates as { range?: Record<string, unknown> } | undefined)?.range;
    put('obs', observationName(selection?.id)); put('obs_detector', observationDetector(selection?.id));
    if (range) { put('from', range.fromDate); put('to', range.toDate); if (range.fromDate || range.fromTime !== '00:00') put('from_time', range.fromTime); if (range.toDate || range.toTime !== '23:59') put('to_time', range.toTime); }
  }
  if (tab === 'Wavelengths') { put('wl', values.wavelength); put('obs', (values.observation as { id?: string } | undefined)?.id); put('obs_detector', (values.observation as { detector?: string } | undefined)?.detector); put('band', values.band); put('date', values.date); }
  if (tab === 'Compare') {
    const filters = values.filters as Record<string, unknown> | undefined;
    if (filters) { put('detector', filters.detector); put('from', filters.from); put('to', filters.to); }
    const frames = values.selection as { a?: string; b?: string; c?: string; d?: string } | undefined;
    for (const slot of ['a', 'b', 'c', 'd'] as const) put(slot, observationName(frames?.[slot]));
    put('mode', values.mode);
    put('group', values.group);
    if (typeof values.manualDates === 'boolean') put('manual', values.manualDates ? 1 : 0);
  }
  return ROUTES[tab] + '?' + params.toString();
}
export function readRoute(location: { pathname: string; search: string }, previous: AnalysisSession): { tab: NavigationTab; session: AnalysisSession; resolveName?: string; error?: string } {
  const params = new URLSearchParams(location.search);
  const legacy = params.get('tab');
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const tab = (path === '/' && legacy && Object.prototype.hasOwnProperty.call(ROUTES, legacy) ? legacy : Object.entries(ROUTES).find(([, route]) => route === path)?.[0] || 'Home') as NavigationTab;
  let session = previous;
  const name = (params.get('target') || params.get('name') || '').trim().slice(0, 200);
  const ra = params.get('ra'), dec = params.get('dec');
  let resolveName: string | undefined;
  if (ra !== null || dec !== null) {
    if (!decimal(ra) || !decimal(dec) || Number(ra) < 0 || Number(ra) >= 360 || Math.abs(Number(dec)) > 90) return { tab, session, error: 'This link has invalid coordinates. Enter RA from 0 to less than 360 and Dec from −90 to +90 on Home.' };
    const a = Number(ra), d = Number(dec), known = session.target;
    if (a !== known.coordinates.ra_deg || d !== known.coordinates.dec_deg || (name && name !== known.query && name !== known.canonical_name)) {
      const formatted = formatCoords(a, d);
      session = { ...session, target: { query: name || `RA ${a}°, Dec ${d}°`, canonical_name: name || `RA ${a}°, Dec ${d}°`, object_type: 'Sky position', coordinates: { ra_deg: a, dec_deg: d, ra_hms: formatted.raStr, dec_dms: formatted.decStr, frame: 'ICRS', epoch: 'Not specified' }, proper_motion: null, aliases: [], provenance: name ? 'URL label — not independently verified' : 'URL coordinates' } };
    }
  } else if (name) resolveName = name;
  if (resolveName) return { tab, session, resolveName };
  if (isAnalysis(tab)) {
    const key = targetIdentity(session.target), view = viewName(tab);
    const set = (field: string, value: unknown) => { session = setPreference(session, key, view, field, value); };
    const detector = params.get('detector');
    if (detectorValid(detector) && !(tab === 'Wavelengths' && detector === 'All')) set('detector', detector);
    const size = Number(params.get('size'));
    if ([50, 100, 200, 290, 400, 800, 2040].includes(size) && !(tab === 'Compare' && size === 2040)) set('size', size);
    const stretch = params.get('stretch'); if (stretch && ['zscale', 'linear', 'log', 'sqrt', 'asinh'].includes(stretch)) set('stretch', stretch);
    const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
    const from = date(params.get('from')), to = date(params.get('to'));
    const obs = params.get('obs')?.slice(0, 200);
    const obsDetector = /^D[1-6]$/.test(params.get('obs_detector') || '') ? params.get('obs_detector')! : detector && detector !== 'All' && detectorValid(detector) ? detector : '';
    if (tab === 'Observations') {
      if (obs) set('selection', { key, id: obsDetector ? JSON.stringify([obs, obsDetector]) : obs });
      if (params.has('from') || params.has('to') || params.has('from_time') || params.has('to_time')) set('dates', { key, range: { fromDate: from, toDate: to, fromTime: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.get('from_time') || '') ? params.get('from_time') : '00:00', toTime: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.get('to_time') || '') ? params.get('to_time') : '23:59' } });
    }
    if (tab === 'Wavelengths') {
      if (obs) set('observation', { id: obs, detector: obsDetector });
      const wl = Number(params.get('wl')); if (wl >= 0.75 && wl <= 5) set('wavelength', wl);
      const band = params.get('band'); if (band === 'ALL' || /^D[1-6]$/.test(band || '')) set('band', band);
      const chosenDate = date(params.get('date')); if (chosenDate || params.get('date') === 'ALL') set('date', chosenDate || 'ALL');
    }
    if (tab === 'Compare') {
      if (params.has('detector') || params.has('from') || params.has('to')) set('filters', { key, detector: detectorValid(detector) && detector !== 'All' ? detector : '', from: from || '', to: to || '' });
      if (['a', 'b', 'c', 'd'].some(slot => params.has(slot))) set('selection', { key, a: params.get('a')?.slice(0, 200) || '', b: params.get('b')?.slice(0, 200) || '', c: params.get('c')?.slice(0, 200) || '', d: params.get('d')?.slice(0, 200) || '' });
      if (['blink', 'grid', 'side-by-side'].includes(params.get('mode') || '')) set('mode', params.get('mode'));
      if (/^D[1-6]-[a-f0-9]{16}$/.test(params.get('group') || '')) set('group', params.get('group'));
      if (['0', '1'].includes(params.get('manual') || '')) set('manualDates', params.get('manual') === '1');
    }
  }
  return { tab, session, resolveName };
}
