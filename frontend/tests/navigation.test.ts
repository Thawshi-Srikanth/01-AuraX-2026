import { describe, expect, test } from 'bun:test';
import { DEFAULT_TARGET, SESSION_KEY, emptySession, readRoute, readSession, routeUrl, setPreference, preference, targetIdentity, validSession, matchesObservation } from '../src/utils/navigation';

const location = (url: string) => new URL(url, 'https://example.test');
const key = targetIdentity(DEFAULT_TARGET);

describe('navigation preserves scientific context', () => {
  test('general comparison preserves simultaneous detectors in shared links', () => {
    let session = setPreference(emptySession(), key, 'compare', 'comparisonKind', 'general');
    session = setPreference(session, key, 'compare', 'selection', { key, a: JSON.stringify(['shared', 'D1']), b: JSON.stringify(['shared', 'D2']) });
    session = setPreference(session, key, 'compare', 'manualDates', true);
    const restored = readRoute(location(routeUrl('Compare', session)), emptySession()).session;
    expect(preference(restored, key, 'compare', 'comparisonKind', '')).toBe('general');
    const frames = preference(restored, key, 'compare', 'selection', { key, a: '', b: '' });
    expect(matchesObservation({ obs_id: 'shared', detector: 'D1' }, frames.a)).toBe(true);
    expect(matchesObservation({ obs_id: 'shared', detector: 'D2' }, frames.a)).toBe(false);
    expect(matchesObservation({ obs_id: 'shared', detector: 'D2' }, frames.b)).toBe(true);
  });
  test('public page paths are independent of target query parameters', () => {
    const session = setPreference(emptySession(), key, 'images', 'selection', { key, id: 'image-A' });
    expect(routeUrl('Home', session)).toBe('/');
    expect(routeUrl('Explore', session)).toBe('/sky');
    expect(routeUrl('Docs', session)).toBe('/docs');
    expect(readRoute(location('/docs'), session).session).toBe(session);
  });
  test('Images → Docs → Wavelengths → Images retains the original selected reference and filters', () => {
    let session = readRoute(location('/images?target=Barnard%27s+Star&ra=269.45208&dec=4.69339&detector=All&obs=exposure-A&obs_detector=D3&from=2025-08-15&from_time=20:00&size=400&stretch=linear'), emptySession()).session;
    const original = routeUrl('Observations', session);
    session = readRoute(location('/docs'), session).session;
    session = setPreference(session, key, 'wavelengths', 'wavelength', 2.12);
    session = readRoute(location('/wavelengths'), session).session;
    expect(routeUrl('Observations', session)).toBe(original);
    expect(preference(session, key, 'wavelengths', 'wavelength', 1.25)).toBe(2.12);
    expect(session.target.query).toBe("Barnard's Star");
  });
  test('detector distinguishes two images from the same exposure after URL round trip', () => {
    let session = setPreference(emptySession(), key, 'images', 'selection', { key, id: JSON.stringify(['shared-exposure', 'D3', 'https://archive.test/a.fits']) });
    session = setPreference(session, key, 'images', 'detector', 'All');
    const url = routeUrl('Observations', session);
    expect(url).toContain('obs_detector=D3');
    expect(url).not.toContain('archive.test');
    const restored = readRoute(location(url), emptySession()).session;
    const id = preference(restored, key, 'images', 'selection', { key, id: '' }).id;
    expect(matchesObservation({ obs_id: 'shared-exposure', detector: 'D3' }, id)).toBe(true);
    expect(matchesObservation({ obs_id: 'shared-exposure', detector: 'D6' }, id)).toBe(false);
  });
  test('wavelength-chart detector is independent of the displayed observation detector', () => {
    const route = readRoute(location('/wavelengths?ra=1&dec=2&target=Label&detector=D2&obs=exposure&obs_detector=D6&wl=1.42&band=ALL&date=2025-08-15'), emptySession());
    const restored = readRoute(location(routeUrl('Wavelengths', route.session)), emptySession()).session;
    const k = targetIdentity(restored.target);
    expect(preference(restored, k, 'wavelengths', 'detector', '')).toBe('D2');
    expect(preference(restored, k, 'wavelengths', 'observation', { id: '', detector: '' })).toEqual({ id: 'exposure', detector: 'D6' });
    expect(preference(restored, k, 'wavelengths', 'wavelength', 1.25)).toBe(1.42);
  });
  test('comparison URL retains both dates, detector and viewing choices', () => {
    const route = readRoute(location('/compare?ra=1&dec=2&detector=D3&a=A&b=B&from=2025-08-15&to=2025-08-25&size=800&mode=side-by-side'), emptySession());
    const session = readRoute(location(routeUrl('Compare', route.session)), emptySession()).session;
    const k = targetIdentity(session.target);
    expect(preference(session, k, 'compare', 'selection', { key: k, a: '', b: '' })).toMatchObject({ a: 'A', b: 'B' });
    expect(preference(session, k, 'compare', 'filters', { key: k, detector: '', from: '', to: '' })).toMatchObject({ detector: 'D3', from: '2025-08-15', to: '2025-08-25' });
  });
  test('matched wavelength choice and manual dates survive a shared URL', () => {
    const route = readRoute(location('/compare?ra=1&dec=2&detector=D2&a=A&b=B&group=D2-1234567890123456&manual=1'), emptySession());
    const restored = readRoute(location(routeUrl('Compare', route.session)), emptySession()).session;
    const k = targetIdentity(restored.target);
    expect(preference(restored,k,'compare','group','')).toBe('D2-1234567890123456');
    expect(preference(restored,k,'compare','manualDates',false)).toBe(true);
  });
  test('same-tab refresh and history snapshots keep small metadata only', () => {
    const session = setPreference(emptySession(), key, 'images', 'size', 800);
    const restored = readSession({ getItem: name => name === SESSION_KEY ? JSON.stringify(session) : null });
    expect(restored).toEqual(session);
    const later = setPreference(session, key, 'images', 'size', 200);
    expect(preference(readRoute(location(routeUrl('Observations', session)), session).session, key, 'images', 'size', 0)).toBe(800);
    expect(preference(later, key, 'images', 'size', 0)).toBe(200);
  });
  test('four comparison frames and grid mode survive shared URLs and Docs', () => {
    const route = readRoute(location('/compare?ra=1&dec=2&detector=D2&a=A&b=B&c=C&d=D&mode=grid'), emptySession());
    const docs = readRoute(location('/docs'), route.session);
    expect(routeUrl('Docs', docs.session)).toBe('/docs');
    const url = routeUrl('Compare', docs.session);
    expect(url).toContain('c=C&d=D&mode=grid');
    const restored = readRoute(location(url), emptySession()).session;
    const k = targetIdentity(restored.target);
    expect(preference(restored, k, 'compare', 'selection', { key: k, a: '', b: '', c: '', d: '' })).toMatchObject({ a: 'A', b: 'B', c: 'C', d: 'D' });
    expect(preference(restored, k, 'compare', 'mode', '')).toBe('grid');
  });
  test('legacy tab links migrate and explicit paths take priority', () => {
    const old = readRoute(location('/?tab=Observations&target=Example&ra=10.123456789&dec=-2&detector=D1'), emptySession());
    expect(old.tab).toBe('Observations');
    expect(routeUrl(old.tab, old.session)).toStartWith('/images?');
    expect(old.session.target.query).toBe('Example');
    expect(old.session.target.coordinates.ra_deg).toBe(10.123456789);
    expect(old.session.target.provenance).toContain('not independently verified');
    expect(readRoute(location('/docs?tab=Compare'), old.session).tab).toBe('Docs');
  });
  test('invalid coordinates never wrap or clamp to another sky position', () => {
    for (const query of ['ra=360&dec=0', 'ra=-1&dec=0', 'ra=10&dec=91', 'ra=10junk&dec=0', 'ra=&dec=0', 'ra=10']) {
      const route = readRoute(location('/images?' + query), emptySession());
      expect(route.error).toBeTruthy();
      expect(route.session.target).toEqual(DEFAULT_TARGET);
    }
  });
  test('name-only links request resolution without overwriting a previous observation', () => {
    const route = readRoute(location('/images?target=WISE+0855&obs=A'), emptySession());
    expect(route.resolveName).toBe('WISE 0855');
    expect(route.session.preferences).toEqual({});
  });
  test('malformed dates, oversized state and bad storage fail safely', () => {
    expect(() => readRoute(location('/images?from=2025-99-99'), emptySession())).not.toThrow();
    expect(readSession({ getItem: () => '{bad' }).target).toEqual(DEFAULT_TARGET);
    expect(readSession({ getItem: () => { throw Error('blocked'); } }).target).toEqual(DEFAULT_TARGET);
    expect(validSession({ ...emptySession(), preferences: { pixels: new Array(100).fill(1) } })).toBe(false);
    expect(readRoute(location('/?tab=__proto__'), emptySession()).tab).toBe('Home');
  });
  test('preferences are isolated per target and bounded to eight positions', () => {
    let session = emptySession();
    for (let i = 0; i < 12; i++) session = setPreference(session, JSON.stringify([i, 0]), 'images', 'size', 200 + i);
    expect(Object.keys(session.preferences)).toHaveLength(8);
    expect(preference(session, '[11,0]', 'images', 'size', 0)).toBe(211);
    expect(preference(session, '[0,0]', 'images', 'size', 0)).toBe(0);
  });
});
