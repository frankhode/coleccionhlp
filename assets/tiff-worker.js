// A fresh worker per TIFF releases the original and all decoded pixels on exit.
// UTIF references window for optional CMYK helpers; no DOM is used here.
self.window = self;
importScripts('./vendor/UTIF.js');

self.onmessage = async ({ data: { file, maxEdge, quality } }) => {
  try {
    const buffer = await file.arrayBuffer();
    const pages = UTIF.decode(buffer);
    const images = pages.filter(page => page.t256?.[0] && page.t257?.[0]);
    // Ignore embedded reduced previews and masks; use the first full page.
    const page = images.find(page => !((page.t254?.[0] || 0) & 5)) || images[0];
    if (!page) throw new Error('El TIFF no contiene una imagen legible.');
    const width = page.t256[0], height = page.t257[0];
    const samples = page.t277?.[0] || page.t258?.length || 1;
    const depth = Math.max(...(page.t258 || [1]));
    const pixels = width * height;
    // Compressed file size alone does not bound memory once decompressed.
    if (!Number.isSafeInteger(pixels) || width < 1 || height < 1 || pixels > 100_000_000
      || pixels * (Math.ceil(depth / 8) * samples + 8) > 600_000_000) {
      throw new Error('El TIFF requiere demasiada memoria. Reducí sus dimensiones o convertí una copia a JPG.');
    }
    const compression = page.t259?.[0] || 1;
    const color = page.t262?.[0] ?? 2;
    if (![1, 3, 4, 5, 6, 7, 8, 32773, 32946].includes(compression)
      || ![0, 1, 2, 3, 5].includes(color)
      || !(page.t258 || [1]).every(value => value === depth)
      || !(page.t339 || [1]).every(value => value === 1)
      || ![1, 2, 4, 8, 16].includes(depth)
      || (color === 0 && depth === 2)
      || (color === 2 && ![8, 16].includes(depth))
      || (color === 3 && depth === 16)
      || (color === 5 && depth !== 8)) {
      throw new Error('Esta variante de TIFF no es compatible. Convertí una copia a JPG para cargarla.');
    }
    UTIF.decodeImage(buffer, page, pages);
    if (!page.data?.length) throw new Error('No se pudieron leer los píxeles del TIFF.');
    const rgba = UTIF.toRGBA8(page);
    const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height));
    try {
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      const orientation = page.t274?.[0] || 1;
      const swapped = orientation >= 5 && orientation <= 8;
      const canvas = new OffscreenCanvas(swapped ? h : w, swapped ? w : h);
      const ctx = canvas.getContext('2d');
      const transforms = {
        2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
        5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0],
        7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w],
      };
      if (transforms[orientation]) ctx.setTransform(...transforms[orientation]);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.type !== 'image/webp') throw new Error('Este navegador no pudo crear WebP. Usá Chrome o Edge.');
      self.postMessage({ blob, width: canvas.width, height: canvas.height });
    } finally { bitmap.close(); }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'No se pudo leer el TIFF. Convertí una copia a JPG para cargarla.' });
  }
};
