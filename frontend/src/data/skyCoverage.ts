// Legacy reference overlays; not live or verified SPHEREx coverage.
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

export interface NavStar {
  name: string;
  ra: number;
  dec: number;
  mag: number;
  specType: string;
  color: string;
}

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
