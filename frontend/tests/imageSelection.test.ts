import { describe, expect, test } from 'bun:test';
import { canvasPixel, imagePosition } from '../src/utils/imageSelection';
import type { CutoutResponse } from '../src/services/api';

// Small identity fixtures only; these are not scientific observations.
const image = { width: 2, height: 2, wcs: { ra_grid: [359.99, 0.01, 100, null], dec_grid: [-1, 0, 1, null] } } as unknown as CutoutResponse;

describe('image region selection', () => {
  test('reads the exact WCS grid including RA wrap, without linear sky approximations', () => {
    expect(imagePosition(image, 0.2, 0.9)?.ra).toBe(359.99);
    expect(imagePosition(image, 1.2, 0.9)?.ra).toBe(0.01);
    expect(imagePosition(image, 0.2, 1.9)?.dec).toBe(1);
    expect(imagePosition(image, 1, 1)).toBeNull();
    expect(imagePosition(image, -1, 0)).toBeNull();
    expect(imagePosition(image, 2, 0)).toBeNull();
  });
  test('maps rotated, zoomed and panned screen coordinates back to the image', () => {
    // Image coordinate (60,40), around image center (50,50), then rotate 90deg.
    const pixel = canvasPixel(340, 230, 600, 400, 100, 100, 2, 20, 10, 90);
    expect(pixel.x).toBeCloseTo(60);
    expect(pixel.y).toBeCloseTo(40);
  });
  test('missing sky calibration cannot open a fabricated position', () => {
    expect(imagePosition({ ...image, wcs: {} } as CutoutResponse, 0, 0)).toBeNull();
  });
});
