import { expect, test } from 'bun:test';
import { emptySession, readRoute, readSession, routeUrl, SESSION_KEY, views, writeSession } from '../src/navigation/session';

const position = { ra: 269.4520769586187, dec: 4.693364966576667 };
const saved = { version: 1 as const, view: 'compare' as const, target: position };
const location = (path: string) => new URL(path, 'https://aurax.example');

test('starts without an invented default target', () => {
  expect(readRoute(location('/'))).toEqual({ view: 'home', target: null, error: null });
});

test('a bare root visit resumes the saved view and coordinates', () => {
  expect(readRoute(location('/'), saved)).toEqual({ view: 'compare', target: position, error: null });
});

test('explicit links override the saved view and coordinates', () => {
  expect(readRoute(location('/images?ra=0&dec=-90'), saved)).toEqual({ view: 'observations', target: { ra: 0, dec: -90 }, error: null });
  expect(readRoute(location('/wavelengths'), saved).view).toBe('wavelengths');
});

test('history restoration without a session uses exactly the URL target', () => {
  expect(readRoute(location('/images')).target).toBeNull();
  expect(readRoute(location('/images?ra=12&dec=20')).target).toEqual({ ra: 12, dec: 20 });
});

test('all view links round-trip coordinates without precision loss', () => {
  for (const view of views) {
    const parsed = readRoute(location(routeUrl(view.id, position)));
    expect(parsed).toEqual({ view: view.id, target: position, error: null });
    expect(readRoute(location(routeUrl(view.id, null))).view).toBe(view.id);
  }
});

for (const query of ['ra=360&dec=0', 'ra=-1&dec=0', 'ra=1&dec=91', 'ra=1&dec=-91',
  'ra=&dec=0', 'ra=0x10&dec=0', 'ra=Infinity&dec=0', 'ra=NaN&dec=0',
  'ra=1', 'dec=0', 'ra=1&ra=2&dec=0', 'ra=1&dec=0&dec=2']) {
  test(`invalid link never silently reuses a saved target: ${query}`, () => {
    const parsed = readRoute(location('/images?' + query), saved);
    expect(parsed.error).toContain('invalid coordinates');
    expect(parsed.target).toBeNull();
  });
}

test('an unknown path is an error rather than a restored view', () => {
  expect(readRoute(location('/missing'), saved).error).toContain('could not be found');
});

test('trailing slashes are accepted and named URL labels do not imply catalog resolution', () => {
  expect(readRoute(location('/images/')).view).toBe('observations');
  expect(readRoute(location('/images?target=SomeStar')).target).toBeNull();
  expect(readRoute(location('/images?target=SomeStar&ra=1&dec=2')).target).toEqual({ ra: 1, dec: 2 });
});

for (const raw of [null, 'broken JSON', JSON.stringify({ version: 2 }),
  JSON.stringify({ ...saved, view: 'missing' }), JSON.stringify({ ...saved, target: { ra: 360, dec: 0 } }),
  JSON.stringify({ ...saved, target: { ra: '12', dec: 0 } }), 'x'.repeat(4097)]) {
  test('invalid or oversized stored data falls back safely: ' + String(raw).slice(0, 70), () => {
    expect(readSession({ getItem: () => raw })).toEqual(emptySession());
  });
}

test('only bounded session fields are restored, without archived/scientific data', () => {
  const raw = JSON.stringify({ ...saved, observations: [{ fake: true }], secret: 'ignored' });
  expect(readSession({ getItem: () => raw })).toEqual(saved);
});

test('session write/read round-trip and unavailable storage do not break navigation', () => {
  let value = '';
  writeSession({ setItem: (key, raw) => { expect(key).toBe(SESSION_KEY); value = raw; } }, { ...saved, error: null });
  expect(readSession({ getItem: () => value })).toEqual(saved);
  expect(readSession({ getItem: () => { throw new Error('blocked'); } })).toEqual(emptySession());
  expect(() => writeSession({ setItem: () => { throw new Error('full'); } }, { ...saved, error: null })).not.toThrow();
});

test('invalid links never overwrite the last valid session', () => {
  let calls = 0;
  writeSession({ setItem: () => { calls++; } }, readRoute(location('/images?ra=invalid'), saved));
  expect(calls).toBe(0);
});
