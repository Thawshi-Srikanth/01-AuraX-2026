import {
  ResolvedTarget,
  SpectrumResponse,
  CutoutResponse,
  SPHERExObservation,
} from '../services/api';

export interface SavedTargetItem {
  id: string;
  target: ResolvedTarget;
  savedAt: string;
  notes: string;
  detector?: string;
  wavelengthUm?: number;
}

const STORAGE_KEY = 'aurax_saved_collections_v1';

const DEFAULT_SAVED_TARGETS: SavedTargetItem[] = [
  {
    id: 'barnards-star',
    target: {
      query: "Barnard's Star",
      canonical_name: "NAME Barnard's star",
      object_type: 'High proper-motion Star',
      coordinates: {
        ra_deg: 269.45208,
        dec_deg: 4.69339,
        ra_hms: '17h 57m 48.50s',
        dec_dms: '+04° 41\' 36.2"',
        frame: 'ICRS',
        epoch: 'J2000',
      },
      proper_motion: {
        pm_ra_mas_yr: -802.8,
        pm_dec_mas_yr: 10362.5,
      },
      aliases: ['GJ 699', 'HIP 87937'],
      provenance: 'CDS / SIMBAD Astronomical Database',
    },
    savedAt: '2025-05-15T06:40:00Z',
    notes: 'M4V red dwarf in Ophiuchus (10.39"/yr proper motion). Primary SPHEREx astrometric benchmark.',
    detector: 'D1',
    wavelengthUm: 0.99,
  },
  {
    id: 'm101-pinwheel',
    target: {
      query: 'M101',
      canonical_name: 'M 101 (Pinwheel Galaxy)',
      object_type: 'Face-on Spiral Galaxy',
      coordinates: {
        ra_deg: 210.80227,
        dec_deg: 54.34895,
        ra_hms: '14h 03m 12.54s',
        dec_dms: '+54° 20\' 56.2"',
        frame: 'ICRS',
        epoch: 'J2000',
      },
      proper_motion: null,
      aliases: ['NGC 5457', 'UGC 8981'],
      provenance: 'CDS / SIMBAD Astronomical Database',
    },
    savedAt: '2025-05-14T18:20:00Z',
    notes: 'Strong 3.30 µm PAH aromatic dust emission across spiral arm H II regions in Detector D4.',
    detector: 'D4',
    wavelengthUm: 3.3,
  },
  {
    id: 'wise-0855',
    target: {
      query: 'WISE 0855-0714',
      canonical_name: 'WISE J085510.83-071442.5',
      object_type: 'Y4 Sub-Brown Dwarf',
      coordinates: {
        ra_deg: 133.7951,
        dec_deg: -7.2451,
        ra_hms: '08h 55m 10.82s',
        dec_dms: '-07° 14\' 42.4"',
        frame: 'ICRS',
        epoch: 'J2000',
      },
      proper_motion: {
        pm_ra_mas_yr: -8118.0,
        pm_dec_mas_yr: 680.0,
      },
      aliases: ['WISE 0855'],
      provenance: 'CDS / SIMBAD Astronomical Database',
    },
    savedAt: '2025-05-12T11:05:00Z',
    notes: '250 K sub-brown dwarf; deep H2O and CH4 absorption bands across D4–D6 (3.0–5.0 µm).',
    detector: 'D5',
    wavelengthUm: 4.27,
  },
];

export function getTargetKey(target: ResolvedTarget): string {
  const name = (target.canonical_name || target.query || 'target')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const ra = ((target.coordinates.ra_deg % 360) + 360) % 360;
  const dec = target.coordinates.dec_deg;
  return `${name}-${ra.toFixed(3)}-${dec.toFixed(3)}`;
}

export function getSavedTargets(): SavedTargetItem[] {
  if (typeof window === 'undefined') return DEFAULT_SAVED_TARGETS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SAVED_TARGETS));
      return DEFAULT_SAVED_TARGETS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_SAVED_TARGETS;
  } catch {
    return DEFAULT_SAVED_TARGETS;
  }
}

export function isTargetSaved(target: ResolvedTarget): boolean {
  const items = getSavedTargets();
  const key = getTargetKey(target);
  const normRa = ((target.coordinates.ra_deg % 360) + 360) % 360;
  return items.some((item) => {
    const itemRa = ((item.target.coordinates.ra_deg % 360) + 360) % 360;
    const raDiff = Math.abs(itemRa - normRa);
    const decDiff = Math.abs(item.target.coordinates.dec_deg - target.coordinates.dec_deg);
    return item.id === key || (raDiff < 0.005 && decDiff < 0.005);
  });
}

export function toggleSaveTarget(
  target: ResolvedTarget,
  notes: string = '',
  detector?: string,
  wavelengthUm?: number
): { saved: boolean; items: SavedTargetItem[] } {
  const items = getSavedTargets();
  const key = getTargetKey(target);
  const normRa = ((target.coordinates.ra_deg % 360) + 360) % 360;

  const existingIdx = items.findIndex((item) => {
    const itemRa = ((item.target.coordinates.ra_deg % 360) + 360) % 360;
    const raDiff = Math.abs(itemRa - normRa);
    const decDiff = Math.abs(item.target.coordinates.dec_deg - target.coordinates.dec_deg);
    return item.id === key || (raDiff < 0.005 && decDiff < 0.005);
  });

  let updated: SavedTargetItem[];
  let saved: boolean;

  if (existingIdx >= 0) {
    updated = items.filter((_, i) => i !== existingIdx);
    saved = false;
  } else {
    const newItem: SavedTargetItem = {
      id: key,
      target: {
        ...target,
        coordinates: {
          ...target.coordinates,
          ra_deg: normRa,
        },
      },
      savedAt: new Date().toISOString(),
      notes: notes || `${target.object_type} at RA ${target.coordinates.ra_hms}, Dec ${target.coordinates.dec_dms}.`,
      detector,
      wavelengthUm,
    };
    updated = [newItem, ...items];
    saved = true;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors
  }

  return { saved, items: updated };
}

export function removeSavedTarget(id: string): SavedTargetItem[] {
  const items = getSavedTargets().filter((item) => item.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
  return items;
}

export function updateSavedTargetNotes(id: string, notes: string): SavedTargetItem[] {
  const items = getSavedTargets().map((item) =>
    item.id === id ? { ...item, notes } : item
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
  return items;
}

function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'spherex_target';
}

export function exportSpectrumCsv(spectrum: SpectrumResponse) {
  const header = [
    '# SPHEREx 102-Channel Calibrated Spectrophotometry (Level 2 Surface Brightness)',
    `# Target: ${spectrum.target_name}`,
    `# RA_deg: ${spectrum.ra_deg.toFixed(6)}`,
    `# Dec_deg: ${spectrum.dec_deg.toFixed(6)}`,
    `# Provenance: ${spectrum.provenance}`,
    'channel_index,detector,wavelength_um,bandwidth_um,resolving_power,flux_mjy_sr,flux_error_mjy_sr,snr',
  ];

  const rows = spectrum.spectral_points.map((pt) =>
    [
      pt.channel_index + 1,
      pt.detector,
      pt.wavelength_um.toFixed(4),
      pt.bandwidth_um.toFixed(4),
      pt.resolving_power.toFixed(1),
      pt.flux_mjy_sr.toFixed(4),
      pt.flux_error_mjy_sr.toFixed(4),
      pt.snr.toFixed(1),
    ].join(',')
  );

  const csv = [...header, ...rows].join('\n');
  triggerFileDownload(
    `${sanitizeFilename(spectrum.target_name)}_spherex_102ch_sed.csv`,
    csv,
    'text/csv;charset=utf-8'
  );
}

export function exportSpectrumIpac(spectrum: SpectrumResponse) {
  const lines: string[] = [
    `\\catalog = 'SPHEREx Level 2 102-Channel LVF Spectrophotometry'`,
    `\\target  = '${spectrum.target_name.replace(/'/g, '')}'`,
    `\\ra_deg  = ${spectrum.ra_deg.toFixed(6)}`,
    `\\dec_deg = ${spectrum.dec_deg.toFixed(6)}`,
    `\\bunit   = 'MJy/sr'`,
    `|channel|detector|wavelength_um|bandwidth_um|resolving_power|flux_mjy_sr |flux_err_mjy|snr     |`,
    `|int    |char    |double       |double      |double         |double      |double      |double  |`,
    `|       |        |um           |um          |               |MJy/sr      |MJy/sr      |        |`,
    `|null   |null    |null         |null        |null           |null        |null        |null    |`,
  ];

  for (const pt of spectrum.spectral_points) {
    const ch = String(pt.channel_index + 1).padStart(7, ' ');
    const det = pt.detector.padEnd(8, ' ');
    const wl = pt.wavelength_um.toFixed(4).padStart(13, ' ');
    const bw = pt.bandwidth_um.toFixed(4).padStart(12, ' ');
    const res = pt.resolving_power.toFixed(1).padStart(15, ' ');
    const flx = pt.flux_mjy_sr.toFixed(4).padStart(12, ' ');
    const err = pt.flux_error_mjy_sr.toFixed(4).padStart(12, ' ');
    const snr = pt.snr.toFixed(1).padStart(8, ' ');
    lines.push(` ${ch} ${det} ${wl} ${bw} ${res} ${flx} ${err} ${snr} `);
  }

  triggerFileDownload(
    `${sanitizeFilename(spectrum.target_name)}_spherex_ipac.tbl`,
    lines.join('\n'),
    'text/plain;charset=utf-8'
  );
}

export function exportSpectrumVOTable(spectrum: SpectrumResponse) {
  const rowsXml = spectrum.spectral_points
    .map(
      (pt) =>
        `        <TR><TD>${pt.channel_index + 1}</TD><TD>${pt.detector}</TD><TD>${pt.wavelength_um.toFixed(4)}</TD><TD>${pt.bandwidth_um.toFixed(4)}</TD><TD>${pt.resolving_power.toFixed(1)}</TD><TD>${pt.flux_mjy_sr.toFixed(4)}</TD><TD>${pt.flux_error_mjy_sr.toFixed(4)}</TD><TD>${pt.snr.toFixed(1)}</TD></TR>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">
  <RESOURCE name="SPHEREx_102Ch_Spectrum">
    <DESCRIPTION>SPHEREx Calibrated 102-Channel LVF Spectrophotometry for ${spectrum.target_name}</DESCRIPTION>
    <PARAM name="Target" datatype="char" arraysize="*" value="${spectrum.target_name}"/>
    <PARAM name="RA" unit="deg" datatype="double" value="${spectrum.ra_deg.toFixed(6)}"/>
    <PARAM name="Dec" unit="deg" datatype="double" value="${spectrum.dec_deg.toFixed(6)}"/>
    <TABLE name="SED_102_Channels">
      <FIELD name="channel" datatype="int"/>
      <FIELD name="detector" datatype="char" arraysize="2"/>
      <FIELD name="wavelength_um" unit="um" datatype="double"/>
      <FIELD name="bandwidth_um" unit="um" datatype="double"/>
      <FIELD name="resolving_power" datatype="double"/>
      <FIELD name="flux_mjy_sr" unit="MJy/sr" datatype="double"/>
      <FIELD name="flux_error_mjy_sr" unit="MJy/sr" datatype="double"/>
      <FIELD name="snr" datatype="double"/>
      <DATA>
        <TABLEDATA>
${rowsXml}
        </TABLEDATA>
      </DATA>
    </TABLE>
  </RESOURCE>
</VOTABLE>`;

  triggerFileDownload(
    `${sanitizeFilename(spectrum.target_name)}_spherex_votable.xml`,
    xml,
    'application/xml;charset=utf-8'
  );
}

export function exportCutoutJson(
  target: ResolvedTarget,
  cutout: CutoutResponse,
  obs?: SPHERExObservation | null
) {
  const payload = {
    instrument: 'NASA SPHEREx Level 2 Spectral Image Cutout',
    exported_at_utc: new Date().toISOString(),
    target: {
      name: target.canonical_name || target.query,
      object_type: target.object_type,
      ra_deg: target.coordinates.ra_deg,
      dec_deg: target.coordinates.dec_deg,
      ra_hms: target.coordinates.ra_hms,
      dec_dms: target.coordinates.dec_dms,
    },
    observation: obs || null,
    cutout_metadata: {
      width: cutout.width,
      height: cutout.height,
      bunit: cutout.bunit || 'MJy/sr',
      min_flux_mjy_sr: cutout.min_flux_mjy_sr,
      max_flux_mjy_sr: cutout.max_flux_mjy_sr,
      mean_flux_mjy_sr: cutout.mean_flux_mjy_sr,
      stretch_applied: cutout.stretch_applied,
      wcs: cutout.wcs,
      source: cutout.source,
    },
    pixels_normalized: cutout.pixels,
  };

  triggerFileDownload(
    `${sanitizeFilename(target.canonical_name || target.query)}_${obs?.detector || 'cutout'}_${cutout.width}px.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
}

export function exportCollectionsManifest(items: SavedTargetItem[]) {
  const payload = {
    collection: 'AURAx SPHEREx Target Collection',
    exported_at_utc: new Date().toISOString(),
    count: items.length,
    targets: items,
  };
  triggerFileDownload(
    'aurax_spherex_collections.json',
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
}
