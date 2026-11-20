import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryEntries, filterGalleryEntries, relatedTerms, imageBibliography } from '../assets/gallery.js';

const record = { sys: '001', title: 'Conjunto de vistas', author: 'Estudio', date: '1900',
  access: ['Argentina Fotografías'], genres: ['Copias a la albúmina'] };
const image = (id, face = '', pairId = null, sortOrder = 0, sys = '001') => ({ id, face, pairId, sortOrder, sys });

test('the grid shows each piece once and retains all of its linked views', () => {
  const assets = [image('back', 'back', 'p', 2), image('front', 'front', 'p', 1),
    image('full', 'stereo-full', 's', 3), image('left', 'stereo-left', 's', 4), image('right', 'stereo-right', 's', 5),
    image('cover', 'other-front', 'o', 6), image('detail', 'other-detail', 'o', 7), image('loose', '', null, 8),
    image('foreign', 'back', 'p', 0, '002')];
  const original = structuredClone(assets);
  const entries = galleryEntries([{ record }], assets);
  assert.deepEqual(entries.map(entry => entry.asset.id), ['front', 'full', 'cover', 'loose']);
  assert.deepEqual(entries.map(entry => entry.images.map(item => item.id)),
    [['front', 'back'], ['full', 'left', 'right'], ['cover', 'detail'], ['loose']]);
  assert.deepEqual(assets, original);
});

test('only published descriptions supply image titles, including links saved on a reverse', () => {
  const assets = [image('front', 'front', 'p'), image('back', 'back', 'p'), image('other')];
  const analytics = [
    { parentSys: '001', title: 'Borrador', status: 'pending', digitalAssetIds: ['front'] },
    { parentSys: '001', title: 'Vista del río', status: 'published', digitalAssetIds: ['back'], subjects: ['Ríos'] },
    { parentSys: '002', title: 'Otro registro', digitalAssetIds: ['other'] },
  ];
  const entries = galleryEntries([{ record }], assets, analytics);
  assert.equal(entries[0].title, 'Vista del río');
  assert.equal(entries[1].title, 'Conjunto de vistas');
  assert.deepEqual(relatedTerms(entries[0]).subjects, ['Ríos']);
});

test('an analytic never borrows descriptive fields or thematic links from its parent', () => {
  const parent = { ...record, physical: '8 fotografías', notes: ['Nota del conjunto'] };
  const entry = { record: parent, analytic: { title: 'Panadero', author: '', date: '', subjects: ['Panaderos'] } };
  assert.deepEqual(imageBibliography(entry), { author: '', date: '', physical: '', notes: '' });
  assert.deepEqual(relatedTerms(entry), { subjects: ['Panaderos'], genres: [] });
  entry.analytic = { ...entry.analytic, author: 'Autora de la imagen', date: '1895', physical: '1 fotografía', notes: 'Nota propia' };
  assert.deepEqual(imageBibliography(entry), { author: 'Autora de la imagen', date: '1895', physical: '1 fotografía', notes: 'Nota propia' });
  delete entry.analytic;
  assert.equal(imageBibliography(entry).physical, '8 fotografías');
  assert.deepEqual(relatedTerms(entry).subjects, ['Argentina']);
});

test('search and thematic links narrow to the matching image inside a set', () => {
  const analytics = [
    { parentSys: '001', title: 'Vista de Córdoba', author: 'Autora A', date: '1890', subjects: ['Ríos'], digitalAssetIds: ['a'] },
    { parentSys: '001', title: 'Puerto', author: 'Autora B', date: '1910', subjects: ['Puertos'], digitalAssetIds: ['b'] },
  ];
  const withContents = { ...record, notes: ['Vista de Córdoba -- Puerto'], allFields: ['Vista de Córdoba -- Puerto'] };
  const entries = galleryEntries([{ record: withContents, items: [{ barcode: 'FO123' }] }], [image('a'), image('b')], analytics);
  assert.deepEqual(filterGalleryEntries(entries, { query: 'cordoba' }).map(entry => entry.asset.id), ['a']);
  assert.deepEqual(filterGalleryEntries(entries, { subject: 'Puertos' }).map(entry => entry.asset.id), ['b']);
  assert.equal(filterGalleryEntries(entries, { author: 'Autora A', subject: 'Puertos' }).length, 0);
  assert.equal(filterGalleryEntries(entries, { from: '1889', to: '1891' }).length, 1);
  assert.equal(filterGalleryEntries(entries, { query: 'FO123' }).length, 2);
  assert.equal(filterGalleryEntries(entries, { query: 'Conjunto' }).length, 2);
});

test('record order is retained and records without images produce no tiles', () => {
  const second = { ...record, sys: '002', title: 'Primero en la búsqueda' };
  const entries = galleryEntries([{ record: second }, { record }, { record: { sys: '003' } }],
    [image('a'), image('b', '', null, 0, '002')]);
  assert.deepEqual(entries.map(entry => entry.asset.id), ['b', 'a']);
});
