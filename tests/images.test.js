import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbnail, imagePath, MAX_IMAGE_BYTES } from '../assets/images.js';

test('TIFF filenames preserve the stem and share collision handling with JPG', () => {
  assert.equal(imagePath('001', 'Retrato.TIFF'), 'images/001/Retrato.webp');
  assert.equal(imagePath('001', 'Retrato.tif', new Set(['images/001/retrato.webp'])), 'images/001/Retrato-2.webp');
});

test('oversized inputs fail before reading the file, with the new limit', async () => {
  assert.equal(MAX_IMAGE_BYTES, 100_000_000);
  await assert.rejects(thumbnail({ size: MAX_IMAGE_BYTES + 1 }), /100 MB/);
});

test('unrecognized formats and BigTIFF are rejected without using the native decoder', async () => {
  for (const bytes of [[0x49, 0x49, 43, 0], [0x50, 0x4b, 3, 4]]) {
    const file = new Blob([Uint8Array.from(bytes)]);
    await assert.rejects(thumbnail(file), /TIFF estándar/);
  }
});
