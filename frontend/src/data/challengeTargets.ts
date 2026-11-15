import type { ResolvedTarget } from '../services/api';

// SIMBAD ICRS J2000 records checked 2026-11-15. These are catalog references,
// not detections in SPHEREx images. pmRa is mu_alpha*cos(delta), mas/year.
export const CHALLENGE_REFERENCE_EPOCH = 2025.5;
export const CHALLENGE_TARGETS = [
  { id: 'barnard', name: "Barnard's Star", type: 'High proper-motion star', ra: 269.4520769586187, dec: 4.693364966576667, pmRa: -801.551, pmDec: 10362.394, epoch: 2000, reference: '2020yCat.1350....0G', source: "https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=Barnard%27s+Star" },
  { id: 'epsilon_indi', name: 'Epsilon Indi B', type: 'Brown dwarf binary', ra: 331.04414658852124, dec: -56.782844195116105, pmRa: 3981.977, pmDec: -2466.832, epoch: 2000, reference: '2020yCat.1350....0G', source: 'https://simbad.u-strasbg.fr/simbad/sim-id?Ident=%2A+eps+Ind+B' },
  { id: 'wise0855', name: 'WISE 0855', type: 'Brown dwarf', ra: 133.81890825, dec: -7.247048, pmRa: -8123.7, pmDec: 673.2, epoch: 2000, reference: '2021ApJS..253....7K', source: 'https://simbad.harvard.edu/simbad/sim-id?Ident=WISE+J085510.83-071442.5', challengePosition: { ra: (8 + 55 / 60 + 10.831 / 3600) * 15, dec: -(7 + 14 / 60 + 42.53 / 3600) } },
  { id: 'rw_aur', name: 'RW Aurigae', type: 'T Tauri variable star', ra: 76.95652603458333, dec: 30.401438173888888, pmRa: 7.23, pmDec: -20.33, epoch: 2000, reference: '2007A&A...474..653V', source: 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=RW+Aur' },
  { id: 'r_dra', name: 'R Draconis', type: 'Mira variable star', ra: 248.16761083295, dec: 66.75497941722, pmRa: -20.643, pmDec: 6.149, epoch: 2000, reference: '2020yCat.1350....0G', source: 'https://simbad.u-strasbg.fr/simbad/sim-id?Ident=R+Dra' },
] as const;

export type ChallengeTarget = typeof CHALLENGE_TARGETS[number];

export function referenceField(target: Pick<ChallengeTarget, 'ra' | 'dec' | 'pmRa' | 'pmDec' | 'epoch'>, epoch = CHALLENGE_REFERENCE_EPOCH) {
  const ra = target.ra * Math.PI / 180, dec = target.dec * Math.PI / 180;
  const dt = (epoch - target.epoch) * Math.PI / (180 * 3600 * 1000);
  // Propagate the unit vector using tangential motion, then renormalize.
  // No distance, radial velocity, perspective acceleration or parallax is assumed.
  const east = [-Math.sin(ra), Math.cos(ra), 0];
  const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
  const original = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const moved = original.map((value, i) => value + dt * (target.pmRa * east[i] + target.pmDec * north[i]));
  const norm = Math.hypot(...moved);
  return { ra: (Math.atan2(moved[1], moved[0]) * 180 / Math.PI + 360) % 360, dec: Math.asin(moved[2] / norm) * 180 / Math.PI };
}

function formatted(value: number, ra: boolean) {
  const total = Math.round(Math.abs(ra ? value / 15 : value) * 360000);
  const degrees = Math.floor(total / 360000), minutes = Math.floor(total % 360000 / 6000);
  const seconds = (total % 6000 / 100).toFixed(2).padStart(5, '0');
  return `${ra ? '' : value < 0 ? '-' : '+'}${String(degrees).padStart(2, '0')}${ra ? 'h' : 'd'}${String(minutes).padStart(2, '0')}m${seconds}s`;
}

export function challengeTarget(target: ChallengeTarget): ResolvedTarget {
  const field = referenceField(target);
  return {
    query: target.name, canonical_name: target.name, object_type: target.type,
    coordinates: { ra_deg: field.ra, dec_deg: field.dec, ra_hms: formatted(field.ra, true), dec_dms: formatted(field.dec, false), frame: 'ICRS', epoch: 'J2025.5 (approximate proper-motion field centre)' },
    proper_motion: { pm_ra_mas_yr: target.pmRa, pm_dec_mas_yr: target.pmDec }, aliases: [],
    provenance: `Challenge benchmark: SIMBAD J2000 reference (${target.reference}); approximate proper-motion centre at J2025.5. Fixed sky field; no parallax or perspective correction.`,
    benchmark: { id: target.id, reference_epoch: target.epoch, field_epoch: CHALLENGE_REFERENCE_EPOCH, reference_ra: target.ra, reference_dec: target.dec, source_url: target.source },
  };
}
