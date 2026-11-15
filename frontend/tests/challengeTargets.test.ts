import { expect, test } from 'bun:test';
import { CHALLENGE_TARGETS, challengeTarget, referenceField } from '../src/data/challengeTargets';
import { emptySession, readSession, SESSION_KEY } from '../src/utils/navigation';

test('all five fixed fields agree with independent Astropy proper-motion calculations', () => {
  // Astropy SkyCoord.apply_space_motion, J2000 -> J2025.5, no distance/RV.
  const expected = [
    [269.4463796045393, 4.76676519379854],
    [331.0956582664693, -56.800306978425816],
    [133.76090262281795, -7.242275827996194],
    [76.9565854112408, 30.401294169708795],
    [248.1672403367638, 66.75502297220228],
  ];
  expect(CHALLENGE_TARGETS).toHaveLength(5);
  for (const [i, entry] of CHALLENGE_TARGETS.entries()) {
    const position = referenceField(entry);
    expect(position.ra).toBeCloseTo(expected[i][0], 8);
    expect(position.dec).toBeCloseTo(expected[i][1], 8);
    expect(referenceField(entry, 2000).ra).toBeCloseTo(entry.ra, 10);
    const target = challengeTarget(entry);
    expect(target.coordinates.epoch).toContain('2025.5');
    expect(target.benchmark?.source_url).toContain('simbad');
  }
});
test('challenge-supplied WISE coordinates remain available without an inferred epoch', () => {
  const wise = CHALLENGE_TARGETS[2];
  expect(wise.challengePosition.ra).toBeCloseTo(133.795129166667, 10);
  expect(wise.challengePosition.dec).toBeCloseTo(-7.245147222222222, 10);
  expect(referenceField(wise).ra).not.toBe(wise.challengePosition.ra);
});
test('only obsolete app-generated examples migrate; user positions remain unchanged', () => {
  const original = emptySession();
  original.target = { ...original.target, coordinates: { ...original.target.coordinates, ra_deg: 269.45208, dec_deg: 4.69339 }, provenance: 'Example starting coordinates; not catalog verified' };
  const read = () => readSession({ getItem: key => key === SESSION_KEY ? JSON.stringify(original) : null });
  expect(read().target.coordinates.ra_deg).toBeCloseTo(269.4463796045393, 8);
  original.target.provenance = 'User-entered coordinates';
  expect(read().target.coordinates.ra_deg).toBe(269.45208);
});
