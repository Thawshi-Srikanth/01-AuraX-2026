import { expect, test } from 'bun:test';
import type { SPHERExObservation } from '../src/services/api';
import { filterComparisonImages } from '../src/utils/comparisonSelection';
import { defaultGeneralSequence } from '../src/utils/comparisonSequence';

const images = Array.from({ length: 6 }, (_, i) => ({
  obs_id: `test-${i}`, detector: i % 2 ? 'D3' : 'D1',
  date_only: `2025-01-0${i + 1}`, utc_date: `2025-01-0${i + 1}T12:00:00Z`,
  mjd_start: 60000 + i, release: i < 3 ? 'dr1' : 'qr3',
  processing_version: 'test-v1', access_url: `https://example.test/${i}.fits`,
  wavelength_center_um: null,
} as SPHERExObservation));
const filters = { detector: '', from: '', to: '', release: '', query: '', sort: 'oldest' };

test('four defaults are distinct and fewer available images are not padded', () => {
  expect(defaultGeneralSequence(images)).toHaveLength(4);
  expect(defaultGeneralSequence(images.slice(0, 3))).toHaveLength(3);
  expect(defaultGeneralSequence([images[0], { ...images[0], access_url: 'reprocessed' }, ...images.slice(1)])).toHaveLength(4);
});
test('detector, inclusive dates, and release filters combine correctly', () => {
  const result = filterComparisonImages(images, { ...filters, detector: 'D3', from: '2025-01-02', to: '2025-01-04', release: 'dr1' });
  expect(result.map(image => image.obs_id)).toEqual(['test-1']);
});
test('search matches real metadata without case or whitespace sensitivity', () => {
  expect(filterComparisonImages(images, { ...filters, query: '  TEST-2 ' }).map(image => image.obs_id)).toEqual(['test-2']);
  expect(filterComparisonImages(images, { ...filters, query: 'QR3' })).toHaveLength(3);
});
test('sorting keeps the source list and selected image objects unchanged', () => {
  const selected = defaultGeneralSequence(images);
  const sorted = filterComparisonImages(images, { ...filters, sort: 'newest' });
  expect(sorted[0]).toBe(images[5]);
  expect(images[0].obs_id).toBe('test-0');
  expect(selected.map(image => image.obs_id)).toEqual(['test-0', 'test-2', 'test-3', 'test-5']);
  expect(filterComparisonImages(images, { ...filters, sort: 'detector' }).map(image => image.detector)).toEqual(['D1', 'D1', 'D1', 'D3', 'D3', 'D3']);
});
test('selecting four from filtered images respects the visible list', () => {
  const visible = filterComparisonImages(images, { ...filters, detector: 'D3', sort: 'newest' });
  expect(defaultGeneralSequence(visible).map(image => image.obs_id)).toEqual(['test-5', 'test-3', 'test-1']);
});
