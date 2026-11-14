import { afterEach, expect, mock, test } from 'bun:test';
import { fetchHealth } from '../src/services/resolverClient';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function respond(body: unknown, status = 200) {
  const stub = mock(async () => new Response(JSON.stringify(body), { status }));
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

test('accepts only a real healthy AURAx response and forwards cancellation', async () => {
  const health = { status: 'healthy', service: 'AURAx API', version: '0.1.0' };
  const stub = respond(health);
  const controller = new AbortController();
  expect(await fetchHealth(controller.signal)).toEqual(health);
  expect(stub.mock.calls[0]).toEqual(['/backend/health', {
    signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store',
  }]);
});

for (const body of [null, {}, { status: 'healthy' },
  { status: 'healthy', service: 'Another API', version: '1' },
  { status: 'unhealthy', service: 'AURAx API', version: '1' },
  { status: 'healthy', service: 'AURAx API', version: '' }]) {
  test(`rejects an invalid health response: ${JSON.stringify(body)}`, async () => {
    respond(body);
    await expect(fetchHealth()).rejects.toThrow('invalid health response');
  });
}

test('HTTP errors never appear connected', async () => {
  respond({ status: 'healthy', service: 'AURAx API', version: '1' }, 503);
  await expect(fetchHealth()).rejects.toThrow('unavailable');
});

test('network failure remains an error', async () => {
  globalThis.fetch = mock(async () => { throw new TypeError('network failure'); }) as unknown as typeof fetch;
  await expect(fetchHealth()).rejects.toThrow('network failure');
});

test('aborted requests remain errors', async () => {
  globalThis.fetch = mock(async (_url: unknown, options: RequestInit) => {
    options.signal?.throwIfAborted();
    return new Response('{}');
  }) as unknown as typeof fetch;
  const controller = new AbortController();
  controller.abort();
  await expect(fetchHealth(controller.signal)).rejects.toThrow();
});
