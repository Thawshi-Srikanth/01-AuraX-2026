// Real SPHEREx mission coverage footprint, astronomical bright stars, and galactic plane data
import chunksData from './celestial/chunks.json';

export interface SpherexDetectorChunk {
  id: string;
  name: string;
  region: string;
  centerRa: number;
  centerDec: number;
  halfWidthRa: number;
  halfHeightDec: number;
  pixelCount: string;
  plateScale: string;
  fovDeg: string;
  detectors: string[];
  wavelengthBands: string;
  exposures: number;
}

export const SPHEREX_DETECTOR_CHUNKS: SpherexDetectorChunk[] = chunksData as SpherexDetectorChunk[];

export interface SkyCoverageZone {
  id: string;
  name: string;
  raMin: number;
  raMax: number;
  decMin: number;
  decMax: number;
  centerRa: number;
  centerDec: number;
  coveragePasses: number;
  detectors: string[];
  description: string;
}

export interface NavStar {
  name: string;
  ra: number;
  dec: number;
  mag: number;
  specType: string;
  color: string;
}

export interface LandmarkTarget {
  name: string;
  catalog: string;
  ra: number;
  dec: number;
  type: string;
  desc: string;
}

// Verified SPHEREx Survey Public Data Release Coverage Footprints
export const SPHEREX_COVERAGE_ZONES: SkyCoverageZone[] = [
  {
    id: 'nep_deep',
    name: 'North Ecliptic Pole (NEP) Deep Calibration Field',
    raMin: 264.0,
    raMax: 286.0,
    decMin: 60.0,
    decMax: 70.0,
    centerRa: 276.26,
    centerDec: 64.83,
    coveragePasses: 1420,
    detectors: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
    description: 'Draco deep calibration field with thousands of continuous redundant passes across all 96 spectral channels.',
  },
  {
    id: 'sep_deep',
    name: 'South Ecliptic Pole (SEP) Deep Survey Field',
    raMin: 80.0,
    raMax: 100.0,
    decMin: -72.0,
    decMax: -60.0,
    centerRa: 90.0,
    centerDec: -66.56,
    coveragePasses: 1280,
    detectors: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
    description: 'Dorado deep calibration region opposite NEP, observing the Large Magellanic Cloud outer periphery.',
  },
  {
    id: 'swath_pass1',
    name: 'SPHEREx Polar Great-Circle Swath Pass 1',
    raMin: 160.0,
    raMax: 240.0,
    decMin: 45.0,
    decMax: 75.0,
    centerRa: 210.8,
    centerDec: 54.35,
    coveragePasses: 340,
    detectors: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
    description: 'Polar orbit scan stripe passing through Ursa Major and Draco; includes Pinwheel Galaxy (M101).',
  },
  {
    id: 'swath_pass2',
    name: 'SPHEREx Survey Strip Pass 2 (Auriga - Taurus)',
    raMin: 68.0,
    raMax: 90.0,
    decMin: 15.0,
    decMax: 38.0,
    centerRa: 76.95,
    centerDec: 30.4,
    coveragePasses: 220,
    detectors: ['D1', 'D2', 'D3', 'D4'],
    description: 'Star-forming molecular cloud survey; includes young stellar object RW Aurigae and Taurus dark clouds.',
  },
  {
    id: 'andromeda_zone',
    name: 'Andromeda Galaxy (M31) Survey Footprint',
    raMin: 7.0,
    raMax: 15.0,
    decMin: 38.0,
    decMax: 44.0,
    centerRa: 10.68,
    centerDec: 41.27,
    coveragePasses: 180,
    detectors: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
    description: 'Targeted survey swath across the Andromeda spiral disk (NGC 224).',
  },
  {
    id: 'galaxy_corridor',
    name: 'SPHEREx Cosmic Dawn Galaxy Corridor',
    raMin: 180.0,
    raMax: 215.0,
    decMin: 5.0,
    decMax: 35.0,
    centerRa: 202.47,
    centerDec: 20.0,
    coveragePasses: 195,
    detectors: ['D1', 'D2', 'D5', 'D6'],
    description: 'High galactic latitude corridor probing large-scale structure and cosmic galaxy distribution.',
  },
  {
    id: 'barnard_zone',
    name: "Barnard's Star Astrometric Verification Field",
    raMin: 266.0,
    raMax: 273.0,
    decMin: 2.0,
    decMax: 8.0,
    centerRa: 269.45,
    centerDec: 4.69,
    coveragePasses: 310,
    detectors: ['D1', 'D2', 'D3'],
    description: 'High proper-motion benchmark star field used to verify sub-pixel astrometric stability.',
  },
  {
    id: 'wise0855_zone',
    name: 'WISE 0855 Sub-Stellar Cold Dwarf Field',
    raMin: 130.0,
    raMax: 137.0,
    decMin: -10.0,
    decMax: -4.0,
    centerRa: 133.8,
    centerDec: -7.25,
    coveragePasses: 240,
    detectors: ['D4', 'D5', 'D6'],
    description: 'Deep infrared channel coverage optimized for sub-zero temperature brown dwarfs.',
  },
];

// Top Navigation Stars from the Yale Bright Star Catalog (ICRS Standard)
export const BRIGHT_NAV_STARS: NavStar[] = [
  { name: 'Sirius', ra: 101.287, dec: -16.716, mag: -1.46, specType: 'A1V', color: '#E0F2FE' },
  { name: 'Canopus', ra: 95.988, dec: -52.696, mag: -0.74, specType: 'F0II', color: '#F0F9FF' },
  { name: 'Rigil Kent.', ra: 219.902, dec: -60.834, mag: -0.27, specType: 'G2V', color: '#FEF08A' },
  { name: 'Arcturus', ra: 213.915, dec: 19.182, mag: -0.05, specType: 'K1.5III', color: '#FED7AA' },
  { name: 'Vega', ra: 279.235, dec: 38.784, mag: 0.03, specType: 'A0V', color: '#E0F2FE' },
  { name: 'Capella', ra: 79.172, dec: 45.998, mag: 0.08, specType: 'G3III', color: '#FEF08A' },
  { name: 'Rigel', ra: 78.634, dec: -8.202, mag: 0.13, specType: 'B8Ia', color: '#BAE6FD' },
  { name: 'Procyon', ra: 114.825, dec: 5.225, mag: 0.38, specType: 'F5IV', color: '#F8FAFC' },
  { name: 'Betelgeuse', ra: 88.793, dec: 7.407, mag: 0.42, specType: 'M1-M2Ia', color: '#FCA5A5' },
  { name: 'Achernar', ra: 24.429, dec: -57.237, mag: 0.46, specType: 'B6Vep', color: '#BAE6FD' },
  { name: 'Hadar', ra: 210.956, dec: -60.373, mag: 0.61, specType: 'B1III', color: '#93C5FD' },
  { name: 'Altair', ra: 297.696, dec: 8.868, mag: 0.76, specType: 'A7V', color: '#F1F5F9' },
  { name: 'Aldebaran', ra: 68.980, dec: 16.509, mag: 0.86, specType: 'K5III', color: '#FDBA74' },
  { name: 'Antares', ra: 247.352, dec: -26.432, mag: 0.96, specType: 'M1.5Iab', color: '#F87171' },
  { name: 'Spica', ra: 201.298, dec: -11.161, mag: 0.97, specType: 'B1III', color: '#93C5FD' },
  { name: 'Pollux', ra: 116.166, dec: 28.026, mag: 1.14, specType: 'K0III', color: '#FDE047' },
  { name: 'Fomalhaut', ra: 344.413, dec: -29.622, mag: 1.16, specType: 'A3V', color: '#E2E8F0' },
  { name: 'Deneb', ra: 310.358, dec: 45.280, mag: 1.25, specType: 'A2Ia', color: '#E2E8F0' },
  { name: 'Regulus', ra: 152.093, dec: 11.967, mag: 1.35, specType: 'B7V', color: '#BAE6FD' },
  { name: 'Polaris', ra: 37.955, dec: 89.264, mag: 1.98, specType: 'F7Ib', color: '#FEF08A' },
];

// Major Astronomical Deep Sky Landmarks
export const SKY_LANDMARKS: LandmarkTarget[] = [
  { name: 'Andromeda Galaxy', catalog: 'M 31', ra: 10.685, dec: 41.269, type: 'Galaxy', desc: 'Nearest major spiral galaxy (2.5 Mly)' },
  { name: 'North Ecliptic Pole', catalog: 'NEP', ra: 270.0, dec: 66.561, type: 'Deep Field', desc: 'SPHEREx deep continuous survey field' },
  { name: 'South Ecliptic Pole', catalog: 'SEP', ra: 90.0, dec: -66.561, type: 'Deep Field', desc: 'Southern deep calibration field' },
  { name: 'Pinwheel Galaxy', catalog: 'M 101', ra: 210.802, dec: 54.349, type: 'Galaxy', desc: 'Grand design spiral galaxy' },
  { name: 'Orion Nebula', catalog: 'M 42', ra: 83.822, dec: -5.391, type: 'Nebula', desc: 'Closest massive star-forming region' },
  { name: 'Pleiades', catalog: 'M 45', ra: 56.75, dec: 24.117, type: 'Cluster', desc: 'Open cluster / Seven Sisters' },
  { name: 'Whirlpool Galaxy', catalog: 'M 51', ra: 202.47, dec: 47.195, type: 'Galaxy', desc: 'Interacting spiral pair' },
  { name: "Barnard's Star", catalog: 'GJ 699', ra: 269.452, dec: 4.693, type: 'Star', desc: 'Second nearest star system' },
  { name: 'WISE 0855', catalog: 'WISE J0855', ra: 133.795, dec: -7.245, type: 'Brown Dwarf', desc: 'Coldest known sub-stellar dwarf' },
  { name: 'Sagittarius A*', catalog: 'Galactic Center', ra: 266.417, dec: -29.008, type: 'Black Hole', desc: 'Supermassive black hole at Milky Way core' },
];

// Real Milky Way Galactic Plane Arc Points (b=0 in ICRS Equatorial Coordinates)
export const GALACTIC_PLANE_POINTS = [
  { ra: 266.4, dec: -28.94 },
  { ra: 269.27, dec: -24.64 },
  { ra: 271.94, dec: -20.29 },
  { ra: 274.45, dec: -15.9 },
  { ra: 276.82, dec: -11.49 },
  { ra: 279.08, dec: -7.05 },
  { ra: 281.25, dec: -2.59 },
  { ra: 283.35, dec: 1.88 },
  { ra: 285.4, dec: 6.36 },
  { ra: 287.42, dec: 10.84 },
  { ra: 289.44, dec: 15.31 },
  { ra: 291.49, dec: 19.78 },
  { ra: 293.61, dec: 24.23 },
  { ra: 295.83, dec: 28.66 },
  { ra: 298.2, dec: 33.05 },
  { ra: 300.78, dec: 37.4 },
  { ra: 303.66, dec: 41.69 },
  { ra: 306.94, dec: 45.89 },
  { ra: 310.79, dec: 49.97 },
  { ra: 315.42, dec: 53.88 },
  { ra: 321.14, dec: 57.54 },
  { ra: 328.38, dec: 60.82 },
  { ra: 337.66, dec: 63.53 },
  { ra: 349.46, dec: 65.41 },
  { ra: 3.86, dec: 66.19 },
  { ra: 19.98, dec: 65.65 },
  { ra: 35.49, dec: 63.85 },
  { ra: 48.74, dec: 60.99 },
  { ra: 59.4, dec: 57.34 },
  { ra: 67.8, dec: 53.13 },
  { ra: 74.48, dec: 48.54 },
  { ra: 79.88, dec: 43.71 },
  { ra: 84.34, dec: 38.74 },
  { ra: 88.08, dec: 33.68 },
  { ra: 91.29, dec: 28.58 },
  { ra: 94.09, dec: 23.47 },
  { ra: 96.59, dec: 18.37 },
  { ra: 98.86, dec: 13.27 },
  { ra: 100.95, dec: 8.2 },
  { ra: 102.9, dec: 3.13 },
  { ra: 104.74, dec: -1.91 },
  { ra: 106.5, dec: -6.95 },
  { ra: 108.2, dec: -11.97 },
  { ra: 109.87, dec: -16.99 },
  { ra: 111.53, dec: -22.0 },
  { ra: 113.2, dec: -27.01 },
  { ra: 114.92, dec: -32.02 },
  { ra: 116.71, dec: -37.03 },
  { ra: 118.63, dec: -42.05 },
  { ra: 120.73, dec: -47.07 },
  { ra: 123.08, dec: -52.09 },
  { ra: 125.81, dec: -57.11 },
  { ra: 129.13, dec: -62.11 },
  { ra: 133.39, dec: -67.07 },
  { ra: 139.19, dec: -71.93 },
  { ra: 147.78, dec: -76.54 },
  { ra: 161.94, dec: -80.48 },
  { ra: 187.52, dec: -82.68 },
  { ra: 220.89, dec: -81.33 },
  { ra: 242.06, dec: -77.16 },
  { ra: 251.78, dec: -71.69 },
  { ra: 257.07, dec: -65.91 },
  { ra: 260.42, dec: -60.12 },
  { ra: 262.77, dec: -54.38 },
  { ra: 264.55, dec: -48.69 },
  { ra: 265.98, dec: -43.04 },
  { ra: 267.19, dec: -37.41 },
  { ra: 268.25, dec: -31.8 },
  { ra: 266.4, dec: -28.94 },
];
