import type { CutoutResponse } from '../services/api';

export interface WavelengthPosition { ra: number; dec: number; label: string }

// The grids come from Astropy's full SIP WCS, in the same row order as the image.
export function imagePosition(cutout: CutoutResponse, x: number, y: number): WavelengthPosition | null {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= cutout.width || iy >= cutout.height) return null;
  const index = iy * cutout.width + ix;
  const ra = cutout.wcs.ra_grid?.[index], dec = cutout.wcs.dec_grid?.[index];
  if (typeof ra !== 'number' || typeof dec !== 'number' || !Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra >= 360 || Math.abs(dec) > 90) return null;
  return { ra, dec, label: 'Image position' };
}

export function canvasPixel(mouseX: number, mouseY: number, width: number, height: number, imageWidth: number, imageHeight: number, zoom: number, panX: number, panY: number, rotation: number) {
  const dx = mouseX - width / 2 - panX, dy = mouseY - height / 2 - panY;
  const rad = -rotation * Math.PI / 180;
  return { x: (dx * Math.cos(rad) - dy * Math.sin(rad)) / zoom + imageWidth / 2,
    y: (dx * Math.sin(rad) + dy * Math.cos(rad)) / zoom + imageHeight / 2 };
}
