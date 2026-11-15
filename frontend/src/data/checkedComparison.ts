import type { SPHERExObservation } from '../services/api';

// Real IRSA metadata checked 2026-11-15. No image pixels are bundled.
// A known-motion illustration, not a precision motion measurement or discovery.
export const CHECKED_COMPARISON: { id: string; name: string; ra: number; dec: number; baseline_days: number; observations: SPHERExObservation[] } = {
  "id": "epsilon-indi",
  "name": "Epsilon Indi B",
  "ra": 331.0956582664693,
  "dec": -56.80030697842581,
  "baseline_days": 508.64356053240743,
  "observations": [
    {
      "artifact_id": "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W18_2B/l2b-v27-2026-197/3/level2_2025W18_2B_0011_4D3_spx_l2b-v27-2026-197.fits",
      "obs_id": "2025W18_2B_0011_4",
      "detector": "D3",
      "band_name": "SPHEREx-D3",
      "release": "dr1",
      "processing_version": "l2b-v27-2026-197",
      "mjd_start": 60796.583346,
      "utc_date": "2025-05-01T14:00:01.094Z",
      "date_only": "2025-05-01",
      "wavelength_min_um": 1.6301,
      "wavelength_max_um": 2.4346,
      "wavelength_center_um": null,
      "exptime_sec": 113.5826,
      "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W18_2B/l2b-v27-2026-197/3/level2_2025W18_2B_0011_4D3_spx_l2b-v27-2026-197.fits"
    },
    {
      "artifact_id": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W39_1A/l2b-v27-2026-268/3/level2_2026W39_1A_0276_1D3_spx_l2b-v27-2026-268.fits",
      "obs_id": "2026W39_1A_0276_1",
      "detector": "D3",
      "band_name": "SPHEREx-D3",
      "release": "qr3",
      "processing_version": "l2b-v27-2026-268",
      "mjd_start": 61305.226906,
      "utc_date": "2026-09-22T05:26:44.678Z",
      "date_only": "2026-09-22",
      "wavelength_min_um": 1.6301,
      "wavelength_max_um": 2.4346,
      "wavelength_center_um": null,
      "exptime_sec": 113.5826,
      "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W39_1A/l2b-v27-2026-268/3/level2_2026W39_1A_0276_1D3_spx_l2b-v27-2026-268.fits"
    }
  ]
};

export function checkedComparisonAt(ra: number, dec: number) {
  return Math.abs(ra - CHECKED_COMPARISON.ra) < 1e-9 && Math.abs(dec - CHECKED_COMPARISON.dec) < 1e-9;
}

export const CHECKED_COMPARISON_URL = '/compare?' + new URLSearchParams({
  target: CHECKED_COMPARISON.name, ra: String(CHECKED_COMPARISON.ra), dec: String(CHECKED_COMPARISON.dec),
  example: CHECKED_COMPARISON.id, comparison: 'matched', size: '50', mode: 'grid', manual: '0',
}).toString();
