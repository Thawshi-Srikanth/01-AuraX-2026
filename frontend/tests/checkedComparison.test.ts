import { expect, test } from 'bun:test';
import { CHECKED_COMPARISON, CHECKED_COMPARISON_URL } from '../src/data/checkedComparison';
import { emptySession, preference, readRoute, routeUrl, targetIdentity } from '../src/utils/navigation';

const location = (url: string) => new URL(url, 'https://example.test');

test('checked example links select the two real observations and round trip their scope', () => {
  const parsed = readRoute(location(CHECKED_COMPARISON_URL), emptySession());
  const key = targetIdentity(parsed.session.target);
  expect(preference(parsed.session, key, 'compare', 'checkedExample', '')).toBe('epsilon-indi');
  expect(preference(parsed.session, key, 'compare', 'comparisonKind', '')).toBe('matched');
  expect(CHECKED_COMPARISON.observations).toHaveLength(2);
  for (const image of CHECKED_COMPARISON.observations) {
    expect(image.access_url).toStartWith('https://irsa.ipac.caltech.edu/ibe/data/spherex/');
    expect(image.detector).toBe('D3');
  }
  expect(CHECKED_COMPARISON.observations[1].mjd_start - CHECKED_COMPARISON.observations[0].mjd_start).toBeCloseTo(CHECKED_COMPARISON.baseline_days, 5);
  const again = readRoute(location(routeUrl('Compare', parsed.session)), emptySession());
  expect(preference(again.session, key, 'compare', 'checkedExample', '')).toBe('epsilon-indi');
});

test('an example label cannot replace arbitrary coordinates or enable a different field', () => {
  const url = location(CHECKED_COMPARISON_URL);
  url.searchParams.set('ra', '120.5');
  const result = readRoute(url, emptySession());
  expect(result.session.target.coordinates.ra_deg).toBe(120.5);
  expect(preference(result.session, targetIdentity(result.session.target), 'compare', 'checkedExample', '')).toBe('');
});

test('leaving a checked link restores archive mode and explicit field sizes survive', () => {
  const url = location(CHECKED_COMPARISON_URL);
  url.searchParams.set('size', '100');
  const initial = readRoute(url, emptySession()).session;
  const key = targetIdentity(initial.target);
  expect(preference(initial, key, 'compare', 'size', 50)).toBe(100);
  url.searchParams.delete('example'); url.searchParams.set('comparison', 'general');
  const normal = readRoute(url, initial).session;
  expect(preference(normal, key, 'compare', 'checkedExample', '')).toBe('');
  expect(preference(normal, key, 'compare', 'comparisonKind', '')).toBe('general');
});
