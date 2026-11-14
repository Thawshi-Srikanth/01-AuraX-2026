export const views = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'explore', label: 'Explore', path: '/sky' },
  { id: 'observations', label: 'Observations', path: '/images' },
  { id: 'compare', label: 'Compare dates', path: '/compare' },
  { id: 'wavelengths', label: 'Wavelengths', path: '/wavelengths' },
  { id: 'collections', label: 'Collections', path: '/saved' },
  { id: 'docs', label: 'Help', path: '/docs' },
] as const;
export type View = typeof views[number]['id'];
export interface Position { ra: number; dec: number }
export interface Session { version: 1; view: View; target: Position | null }
export interface Route { view: View; target: Position | null; error: string | null }
export const SESSION_KEY = 'aurax.frontend.session.v1';
export const emptySession = (): Session => ({ version: 1, view: 'home', target: null });
type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

function validPosition(value: unknown): value is Position {
  return typeof value === 'object' && value !== null &&
    'ra' in value && typeof value.ra === 'number' && Number.isFinite(value.ra) && value.ra >= 0 && value.ra < 360 &&
    'dec' in value && typeof value.dec === 'number' && Number.isFinite(value.dec) && value.dec >= -90 && value.dec <= 90;
}

export function readSession(storage: StorageReader): Session {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw || raw.length > 4096) return emptySession();
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null ||
      !('version' in value) || value.version !== 1 ||
      !('view' in value) || !views.some((view) => view.id === value.view) ||
      !('target' in value) || (value.target !== null && !validPosition(value.target))) return emptySession();
    const target = value.target === null ? null : { ra: value.target.ra, dec: value.target.dec };
    return { version: 1, view: value.view as View, target };
  } catch { return emptySession(); }
}

export function writeSession(storage: StorageWriter, route: Route): void {
  if (route.error) return;
  try {
    storage.setItem(SESSION_KEY, JSON.stringify({ version: 1, view: route.view, target: route.target }));
  } catch { /* Navigation remains usable when storage is blocked or full. */ }
}

const decimal = (value: string | null): value is string => value !== null &&
  /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value));

export function readRoute(location: Pick<Location, 'pathname' | 'search'>, saved?: Session): Route {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const view = views.find((item) => item.path === path);
  if (!view) return { view: 'home', target: null, error: 'This page could not be found.' };
  const params = new URLSearchParams(location.search);
  if (params.has('ra') || params.has('dec')) {
    const ra = params.get('ra'), dec = params.get('dec');
    if (params.getAll('ra').length !== 1 || params.getAll('dec').length !== 1 ||
      !decimal(ra) || !decimal(dec) || !validPosition({ ra: Number(ra), dec: Number(dec) })) {
      return { view: view.id, target: null, error: 'This link has invalid coordinates. RA must be 0 to less than 360; Dec must be −90 to +90.' };
    }
    return { view: view.id, target: { ra: Number(ra), dec: Number(dec) }, error: null };
  }
  // Only a bare root visit resumes the last view. Explicit deep links win.
  if (path === '/' && !location.search && saved) {
    return { view: saved.view, target: saved.target, error: null };
  }
  return { view: view.id, target: saved?.target ?? null, error: null };
}

export function routeUrl(view: View, target: Position | null): string {
  const path = views.find((item) => item.id === view)!.path;
  return target === null ? path : path + '?' + new URLSearchParams({ ra: String(target.ra), dec: String(target.dec) });
}
