import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Render the actual compiled upload panel with inert React primitives.
const source = await readFile(new URL('../assets/legacy.js', import.meta.url), 'utf8');
const panel = source.slice(source.indexOf('function hlpHasBarcode('), source.indexOf('function fg('));
const jsx = (type, props) => ({ type, props });
const context = vm.createContext({
  T: { useState: value => [value, () => {}], useRef: value => ({ current: value }) },
  n: { jsx, jsxs: jsx },
  Il: value => String(value).replace(/\D/g, '').replace(/^0+/, ''), Se: String,
});
const faceLabel = source.slice(source.indexOf('function dg('), source.indexOf('function Il('));
vm.runInContext(`${faceLabel}${panel};globalThis.render=MS;`, context);
const records = [
  { record: { sys: '001', title: 'Primer registro', author: 'Autor', fasNumbers: [] }, items: [{ barcode: 'FO000111' }, { barcode: 'FO000222' }] },
  { record: { sys: '002', title: 'Otro registro', author: 'Otro autor', fasNumbers: [] }, items: [{ barcode: 'FO000333' }] },
  { record: { sys: '003', title: 'Sin barcode', author: '', fasNumbers: [] }, items: [] },
];
const assets = [{ id: 'front', sys: '001', originalName: 'retrato.tif', pairId: null }];
function cards(tab, query, selectedAssets = []) {
  const tree = context.render({ assets: selectedAssets, records, summaries: {}, tab, query, status: '', busy: false, pairBatch: [], pairProposals: [] });
  const result = [];
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'article') result.push(node);
    walk(node.props?.children);
  }
  walk(tree); return result;
}

test('upload search finds any item barcode of records without images', () => {
  assert.equal(cards('missing', 'FO000222').length, 1);
  assert.equal(cards('missing', 'fo 000-222').length, 1);
  assert.equal(cards('missing', '000222').length, 1);
  assert.equal(cards('missing', 'FO999999').length, 0);
});

test('barcode search works for loaded images and loose images', () => {
  assert.equal(cards('loaded', 'FO000111', assets).length, 1);
  assert.equal(cards('pairs', 'FO000222', assets).length, 1);
  assert.equal(cards('missing', 'FO000222', assets).length, 0);
  assert.equal(cards('loaded', 'FO000333', assets).length, 0);
});

test('existing searches by title, SYS, author and filename keep working', () => {
  for (const query of ['Primer registro', '001', 'Autor', 'retrato.tif']) assert.equal(cards('loaded', query, assets).length, 1);
  assert.equal(cards('missing', '').length, 3);
  assert.equal(cards('missing', 'Sin barcode').length, 1);
});
