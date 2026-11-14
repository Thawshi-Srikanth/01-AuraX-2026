import type { CutoutResponse, CatalogSource } from '../services/api';

export interface SkyPosition { ra: number; dec: number; label: string }
export interface ImageSelection extends SkyPosition { x: number; y: number; sourceId?: string }

// The grids come from Astropy's full SIP WCS, in the same row order as the image.
export function imagePosition(cutout: CutoutResponse, x: number, y: number): ImageSelection | null {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= cutout.width || iy >= cutout.height) return null;
  const index = iy * cutout.width + ix;
  const ra = cutout.wcs.ra_grid?.[index], dec = cutout.wcs.dec_grid?.[index];
  if (typeof ra !== 'number' || typeof dec !== 'number' || !Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra >= 360 || Math.abs(dec) > 90) return null;
  return { ra, dec, x: ix, y: iy, label: 'Image position' };
}

export function canvasPixel(mouseX: number, mouseY: number, width: number, height: number, imageWidth: number, imageHeight: number, zoom: number, panX: number, panY: number, rotation: number) {
  const dx = mouseX - width / 2 - panX, dy = mouseY - height / 2 - panY;
  const rad = -rotation * Math.PI / 180;
  return { x: (dx * Math.cos(rad) - dy * Math.sin(rad)) / zoom + imageWidth / 2,
    y: (dx * Math.sin(rad) + dy * Math.cos(rad)) / zoom + imageHeight / 2 };
}


export function catalogSelection(cutout: CutoutResponse, source: Pick<CatalogSource, 'id' | 'name' | 'ra_deg' | 'dec_deg'>, pixel: number[] | null): ImageSelection | null {
  if (!pixel || pixel.length !== 2 || !pixel.every(Number.isFinite) || !Number.isFinite(source.ra_deg) || !Number.isFinite(source.dec_deg) || source.ra_deg < 0 || source.ra_deg >= 360 || Math.abs(source.dec_deg) > 90) return null;
  const [x, y] = pixel;
  if (x < -.5 || x >= cutout.width - .5 || y < -.5 || y >= cutout.height - .5) return null;
  return { x, y, ra: source.ra_deg, dec: source.dec_deg, label: source.name, sourceId: source.id };
}
export function nearestCatalogSource(sources: CatalogSource[], rawX: number, rawY: number, zoom: number, tolerance = 14) {
  let closest: CatalogSource | null = null, distance = tolerance;
  for (const source of sources) {
    const next = Math.hypot(rawX - (source.pixel_x + .5), rawY - (source.pixel_y + .5)) * zoom;
    if (next < distance) { closest = source; distance = next; }
  }
  return closest;
}
