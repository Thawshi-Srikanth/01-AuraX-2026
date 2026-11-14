import { expect, test } from 'bun:test';
import { imageRaster } from '../src/utils/imageRaster';
import type { CutoutResponse } from '../src/services/api';
const lut = Uint8ClampedArray.from({ length: 768 }, (_, i) => Math.floor(i/3));

test('valid zero stays opaque black while masked, null and nonfinite pixels are transparent', () => {
  const image = { width: 5, height: 1, pixels: [0, .5, .7, NaN, null], valid_pixels: [true, true, false, true, true] } as unknown as CutoutResponse;
  const rgba = imageRaster(image, lut);
  expect([...rgba.slice(0,4)]).toEqual([0,0,0,255]);
  expect([...rgba.slice(4,8)]).toEqual([128,128,128,255]);
  expect([...rgba.slice(8)]).toEqual([0,0,0,0,0,0,0,0,0,0,0,0]);
  expect(image.pixels[2]).toBe(.7);
});
test('colormaps affect valid pixels without filling masked measurements', () => {
  const image = { width: 2, height: 1, pixels: [1, .5], valid_pixels: [true, false] } as CutoutResponse;
  const color = new Uint8Array(768); color[765] = 9; color[766] = 100; color[767] = 200;
  expect([...imageRaster(image, color)]).toEqual([9,100,200,255,0,0,0,0]);
});


test('display mask permits warned context without changing the stricter analysis mask', () => {
  const image = { width: 2, height: 1, pixels: [.5, NaN], valid_pixels: [false, false], display_valid_pixels: [true, false] } as CutoutResponse;
  expect([...imageRaster(image, lut)]).toEqual([128,128,128,255,0,0,0,0]);
  expect(image.valid_pixels).toEqual([false, false]);
});
