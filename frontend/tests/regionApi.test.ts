import { afterEach, expect, test } from 'bun:test';
import { angularSize, fetchRegionAnalysis, fetchRegionCatalog } from '../src/services/api';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

test('region analysis sends the exact display cache identity and cancellation without another cutout request', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ status: 'insufficient_data', measurements: null })); }) as typeof fetch;
  const signal = new AbortController().signal;
  const result = await fetchRegionAnalysis('https://example.test/image.fits', 100, 20, 200, 100.002, 20.001, signal);
  expect(result.measurements).toBeNull();
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toEndWith('/api/region');
  expect(calls[0].init?.signal).toBe(signal);
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ access_url: 'https://example.test/image.fits', center_ra: 100, center_dec: 20, size_deg: angularSize(200), ra: 100.002, dec: 20.001 });
});

test('catalog context is a separate bounded real lookup with cancellation', async () => {
  let requested = ''; let forwarded: AbortSignal | null | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { requested = url; forwarded = init?.signal; return new Response(JSON.stringify({ sources: [], truncated: false })); }) as typeof fetch;
  const signal = new AbortController().signal;
  expect((await fetchRegionCatalog(100, 20, signal)).sources).toEqual([]);
  expect(requested).toContain('/api/catalog/sources?');
  expect(requested).toContain('radius_arcmin=1'); expect(requested).toContain('limit=20');
  expect(forwarded).toBe(signal);
});

test('cached miss remains an error instead of inventing measurements', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'Image no longer cached' }), { status: 409 })) as typeof fetch;
  await expect(fetchRegionAnalysis('https://example.test/image.fits', 100, 20, 200, 100, 20, new AbortController().signal)).rejects.toThrow('Image no longer cached');
});
