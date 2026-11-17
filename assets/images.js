import { config } from './config.js';

export function safeSegment(value) {
  const cleaned = String(value).normalize('NFC').replace(/[\x00-\x1f\x7f/\\:*?"<>|#%]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return cleaned.slice(0, 150) || 'sin-nombre';
}

export function imagePath(sys, originalName, usedPaths = new Set()) {
  const stem = safeSegment(originalName.replace(/\.(jpe?g|png|webp|tiff?)$/i, ''));
  const prefix = `images/${safeSegment(sys)}/${stem}`;
  let path = `${prefix}.webp`, suffix = 2;
  while (usedPaths.has(path.toLocaleLowerCase('es'))) path = `${prefix}-${suffix++}.webp`;
  return path;
}

export const MAX_IMAGE_BYTES = 100_000_000;
let tiffQueue = Promise.resolve();

function tiffThumbnail(file) {
  // One decoder at a time, including uploads started from different views.
  const task = tiffQueue.then(() => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./tiff-worker.js', import.meta.url));
    const finish = (error, result) => {
      clearTimeout(timeout); worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const timeout = setTimeout(() => finish(new Error('El TIFF tardó demasiado en procesarse. Probá convertirlo a JPG.')), 120_000);
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data);
    worker.onerror = event => { event.preventDefault(); finish(new Error('No se pudo leer el TIFF. Probá convertirlo a JPG.')); };
    worker.postMessage({ file, maxEdge: config.thumbnailMaxEdge, quality: config.thumbnailQuality });
  }));
  tiffQueue = task.catch(() => {});
  return task;
}

export async function thumbnail(file) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Elegí imágenes de hasta 100 MB por archivo.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const tiff = (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42);
  if (tiff) return tiffThumbnail(file);
  if (!jpeg && !png && !webp) throw new Error(`Formato no compatible: ${file.name}. Elegí JPG, PNG, WebP o TIFF estándar.`);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, config.thumbnailMaxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', config.thumbnailQuality));
    if (!blob || blob.type !== 'image/webp') throw new Error('Este navegador no pudo crear la miniatura WebP. Usá Chrome o Edge.');
    return { blob, width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

const key = value => value.normalize('NFC').toLocaleLowerCase('es').replaceAll('\\', '/');

export class LocalImages {
  constructor() { this.files = new Map(); this.names = new Map(); this.urls = new Map(); this.folderName = ''; this.handle = null; }

  add(path, file) {
    this.files.set(key(path), file);
    const name = key(path.split('/').at(-1));
    const paths = this.names.get(name) || [];
    paths.push(key(path)); this.names.set(name, paths);
  }

  clear() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.files.clear(); this.names.clear(); this.urls.clear();
  }

  async fromHandle(handle) {
    this.clear(); this.handle = handle; this.folderName = handle.name;
    const visit = async (directory, prefix = '') => {
      for await (const [name, entry] of directory.entries()) {
        const path = prefix + name;
        if (entry.kind === 'directory') await visit(entry, path + '/');
        else if (/\.(jpe?g|png|webp)$/i.test(name)) this.add(path, entry);
      }
    };
    await visit(handle);
  }

  fromFiles(files) {
    this.clear(); this.handle = null;
    this.folderName = files[0]?.webkitRelativePath.split('/')[0] || 'Carpeta seleccionada';
    for (const file of files) {
      if (/\.(jpe?g|png|webp)$/i.test(file.name)) this.add(file.webkitRelativePath.split('/').slice(1).join('/') || file.name, file);
    }
  }

  resolvePath(asset) {
    if (asset.originalPath && this.files.has(key(asset.originalPath))) return key(asset.originalPath);
    const matches = this.names.get(key(asset.originalName)) || [];
    return matches.length === 1 ? matches[0] : null;
  }

  async url(asset) {
    const path = this.resolvePath(asset);
    if (!path) return null;
    if (!this.urls.has(path)) {
      const entry = this.files.get(path);
      try {
        this.urls.set(path, URL.createObjectURL(entry.kind === 'file' ? await entry.getFile() : entry));
        if (this.urls.size > 3) {
          const oldest = this.urls.keys().next().value;
          URL.revokeObjectURL(this.urls.get(oldest)); this.urls.delete(oldest);
        }
      }
      catch { return null; }
    }
    return this.urls.get(path);
  }

  get duplicates() { return [...this.names.values()].filter(paths => paths.length > 1).length; }
}

