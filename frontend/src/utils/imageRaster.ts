import type { CutoutResponse } from '../services/api';
export function usableDisplayPixel(cutout: CutoutResponse, index: number) {
  return cutout.valid_pixels?.[index] !== false && Number.isFinite(cutout.pixels[index]);
}
// Invalid data stays transparent so the explicit mask pattern can show through.
// Valid zero is an opaque measurement at the colormap's true lower limit.
export function imageRaster(cutout: CutoutResponse, lut: ArrayLike<number>) {
  const rgba = new Uint8ClampedArray(cutout.width * cutout.height * 4);
  for (let i = 0; i < cutout.width * cutout.height; i++) {
    if (!usableDisplayPixel(cutout, i)) continue;
    const sample = Math.round(Math.max(0, Math.min(1, cutout.pixels[i])) * 255) * 3;
    rgba[i*4] = lut[sample]; rgba[i*4+1] = lut[sample+1]; rgba[i*4+2] = lut[sample+2]; rgba[i*4+3] = 255;
  }
  return rgba;
}
