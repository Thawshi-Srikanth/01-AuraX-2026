import { afterEach, expect, mock, test } from 'bun:test';
import { resolveTarget, targetParameters } from '../src/services/resolverClient';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const manual = {
  canonical_name: 'Test position', object_type: 'Coordinate Location',
  coordinates: { ra_deg: 12.3456789012345, dec_deg: -20, frame: 'ICRS', epoch: null },
  provenance: 'User-supplied ICRS coordinates; no catalog verification',
  source_url: null, coordinate_reference: null, retrieved_at: null, cached: false,
};
// Explicitly synthetic response, never bundled as app data or a catalog observation.
const named = { ...manual, canonical_name: 'Synthetic test fixture', object_type: 'Star',
  provenance: 'CDS / SIMBAD via TAP', source_url: 'https://simbad.cfa.harvard.edu/simbad/sim-tap',
  retrieved_at: '2026-11-14T00:00:00Z', coordinate_reference: 'test-only' };
function respond(body: unknown, status = 200) {
  const fetch = mock(async () => new Response(JSON.stringify(body), { status }));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}

test('names are trimmed and encoded without combining coordinate parameters', () => {
  const params = targetParameters({ kind: 'name', name: " Barnard's Star & identifier " });
  expect(params.get('target')).toBe("Barnard's Star & identifier");
  expect(params.has('ra')).toBe(false);
  expect(new URLSearchParams(params.toString()).get('target')).toBe("Barnard's Star & identifier");
});

test('coordinates keep numeric precision and do not add a target name', () => {
  const params = targetParameters({ kind: 'coordinates', ra: '12.3456789012345', dec: '-20' });
  expect(Number(params.get('ra'))).toBe(manual.coordinates.ra_deg);
  expect(params.has('target')).toBe(false);
  expect(targetParameters({ kind: 'coordinates', ra: '0', dec: '-90' }).get('dec')).toBe('-90');
});

for (const name of ['', '  ', 'x'.repeat(201), 'a\nb', 'a\u007fb']) {
  test('invalid names do not contact the API: ' + JSON.stringify(name).slice(0, 40), async () => {
    const fetch = respond(named);
    await expect(resolveTarget({ kind: 'name', name })).rejects.toThrow('Enter an object name');
    expect(fetch).not.toHaveBeenCalled();
  });
}
for (const [ra, dec] of [['360', '0'], ['-1', '0'], ['1', '91'], ['1', '-91'], ['NaN', '0'], ['0x10', '0'], ['', '0'], ['1e999', '0']]) {
  test(`invalid coordinates do not contact the API: ${ra}, ${dec}`, async () => {
    const fetch = respond(manual);
    await expect(resolveTarget({ kind: 'coordinates', ra, dec })).rejects.toThrow('Enter RA');
    expect(fetch).not.toHaveBeenCalled();
  });
}

test('manual results are validated against exactly the requested coordinates', async () => {
  respond(manual);
  const result = await resolveTarget({ kind: 'coordinates', ra: '12.3456789012345', dec: '-20' });
  expect(result.source_url).toBeNull();
  expect(result.coordinates.epoch).toBeNull();
  respond({ ...manual, coordinates: { ...manual.coordinates, ra_deg: 12 } });
  await expect(resolveTarget({ kind: 'coordinates', ra: '12.3456789012345', dec: '-20' })).rejects.toThrow('invalid target data');
});

test('named lookup preserves real source metadata and forwards cancellation', async () => {
  const fetch = respond(named);
  const controller = new AbortController();
  const result = await resolveTarget({ kind: 'name', name: 'Synthetic fixture' }, controller.signal);
  expect(result.provenance).toBe(named.provenance);
  expect(result.source_url).toBe(named.source_url);
  expect(result.coordinate_reference).toBe('test-only');
  expect(result.coordinates.epoch).toBeNull();
  expect(fetch.mock.calls[0]).toEqual(['/backend/api/resolve?target=Synthetic+fixture', {
    signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store',
  }]);
});

for (const body of [null, {}, { ...named, source_url: 'javascript:alert(1)' },
  { ...named, source_url: 'https://user:secret@simbad.cfa.harvard.edu/simbad/sim-tap' },
  { ...named, source_url: null }, { ...named, retrieved_at: null },
  { ...named, coordinates: { ...named.coordinates, frame: 'FK5' } },
  { ...named, coordinates: { ...named.coordinates, dec_deg: 91 } }]) {
  test('invalid or unverifiable payload is not a catalog success: ' + JSON.stringify(body).slice(0, 60), async () => {
    respond(body);
    await expect(resolveTarget({ kind: 'name', name: 'Fixture' })).rejects.toThrow('invalid target data');
  });
}
for (const [status, message] of [[404, 'No matching object'], [409, 'more specific'], [422, 'coordinate ranges'], [502, 'unusable target data'], [503, 'unavailable']] as const) {
  test(`HTTP ${status} remains a clear error, never a coordinate fallback`, async () => {
    respond({}, status);
    await expect(resolveTarget({ kind: 'name', name: 'Fixture' })).rejects.toThrow(message);
  });
}

test('bad JSON and transport errors do not produce targets', async () => {
  globalThis.fetch = mock(async () => new Response('not json')) as unknown as typeof fetch;
  await expect(resolveTarget({ kind: 'name', name: 'Fixture' })).rejects.toThrow('invalid target data');
  globalThis.fetch = mock(async () => { throw new TypeError('network failure'); }) as unknown as typeof fetch;
  await expect(resolveTarget({ kind: 'name', name: 'Fixture' })).rejects.toThrow('network failure');
});
