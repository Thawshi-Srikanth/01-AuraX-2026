import { describe, expect, test } from 'bun:test';
import { canvasPixel, imagePosition, catalogSelection, nearestCatalogSource } from '../src/utils/imageSelection';
import type { CutoutResponse, CatalogSource } from '../src/services/api';

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


const source = { id: 'fixture-source', name: 'Fixture source', ra_deg: 359.999, dec_deg: -20, pixel_x: .25, pixel_y: .75 } as CatalogSource;
test('catalog selection preserves exact sky position and subpixel projection, without substituting the clicked pixel', () => {
  expect(catalogSelection(image, source, [.25,.75])).toEqual({ x:.25, y:.75, ra:359.999, dec:-20, label:'Fixture source', sourceId:'fixture-source' });
});
test('outside, divergent or missing WCS projections never clamp or select a different position', () => {
  for (const pixel of [null, [NaN,1], [1], [-.51,0], [1.5,0], [0,1.5]]) expect(catalogSelection(image, source, pixel)).toBeNull();
  expect(catalogSelection(image, source, [-.49,0])).not.toBeNull();
});
test('marker hit selection uses nearest subpixel center rather than list order', () => {
  const farther = {...source, id:'farther', pixel_x:.9};
  expect(nearestCatalogSource([farther,source], .76,1.25,10)?.id).toBe(source.id);
  expect(nearestCatalogSource([source],100,100,10)).toBeNull();
});
test('different catalog records sharing coordinates keep their selected identities', () => {
  expect(catalogSelection(image, {...source,id:'record-b'}, [.25,.75])?.sourceId).toBe('record-b');
});
