import { expect, test } from 'bun:test';
import { detectorMatches, selectedDetectors, toggleDetector, validDetectorSelection } from '../src/utils/detectors';
import { emptySession, preference, readRoute, routeUrl, targetIdentity } from '../src/utils/navigation';

test('detector checkboxes independently add and remove filters', () => {
  expect(toggleDetector('All', 'D1')).toBe('D2,D3,D4,D5,D6');
  expect(toggleDetector('None', 'D3')).toBe('D3');
  expect(toggleDetector('D3', 'D3')).toBe('None');
  expect(toggleDetector('D2,D3,D4,D5,D6', 'D1')).toBe('All');
  expect(selectedDetectors('None')).toEqual([]);
  expect(detectorMatches('D3', 'D1,D3')).toBe(true);
  expect(detectorMatches('D2', 'D1,D3')).toBe(false);
});
test('multi-detector filters survive shared image and comparison links', () => {
  for (const path of ['/images', '/compare']) {
    const url = new URL(path + '?ra=1&dec=2&detector=D1,D3&size=16', 'http://example.test');
    const route = readRoute(url, emptySession());
    const restored = readRoute(new URL(routeUrl(route.tab, route.session), url), emptySession());
    const key = targetIdentity(restored.session.target);
    const view = path === '/images' ? 'images' : 'compare';
    const detectors = view === 'images' ? preference(restored.session, key, view, 'detector', '') : preference(restored.session, key, view, 'filters', { key, detector: '', from: '', to: '' }).detector;
    expect(detectors).toBe('D1,D3');
    expect(preference(restored.session, key, view, 'size', 0)).toBe(16);
  }
});
test('invalid detector values do not become valid filter selections', () => {
  for (const value of ['D7', 'D1,D1', 'D1,All', '', 'D1,D2,D3,D4,D5,D6,D1']) expect(validDetectorSelection(value)).toBe(false);
  expect(validDetectorSelection('None')).toBe(true);
});
