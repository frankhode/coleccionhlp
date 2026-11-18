import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { BrowserAPI } from '../assets/api.js';
import { Workspace, createWorkspace } from '../assets/store.js';

// Test the image associations independently of native browser image codecs.
globalThis.createImageBitmap = async () => ({ width: 20, height: 10, close() {} });
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob(callback) { callback(new Blob(['RIFFpreviewWEBP'], { type: 'image/webp' })); } }) };
const actor = { name: 'Prueba' };
function setup() {
  const initial = { version: 1, data: { containers: [], boxes: {}, analyticRecords: ['one', 'two'].map(id => ({ id, parentSys: '001', title: id, status: 'published', digitalAssetIds: [] })) } };
  const store = { async write(value) { this.saved = structuredClone(value); } };
  const workspace = new Workspace(store, createWorkspace(initial, {}, 'a'.repeat(40)), actor);
  const api = new BrowserAPI({ workspace, actor, baseURL: 'https://example.test/' });
  return { workspace, api, store };
}
function batch(analyticId, sys = '001', count = 1) {
  const data = new FormData(); data.set('sys', sys);
  if (analyticId) data.set('analyticId', analyticId);
  for (let i = 0; i < count; i++) data.append('files[]', new File([Uint8Array.from([0xff, 0xd8, 0xff])], `foto-${i}.jpg`, { type: 'image/jpeg' }));
  return data;
}
const route = path => new URL(`https://example.test/api/${path}`);
const upload = (api, body) => api.handle(route('digitals'), { method: 'POST', body });

test('analytic uploads persist their association and the parent contains the union once', async () => {
  const { api, workspace, store } = setup();
  const first = await (await upload(api, batch('one', '001', 2))).json();
  const second = await (await upload(api, batch('two'))).json();
  assert.equal(first.analytic.digitalAssetIds.length, 2);
  assert.equal(second.analytic.digitalAssetIds.length, 1);
  assert.equal(workspace.value.state.version, 3);
  const parent = await (await api.handle(route('digitals?sys=001'))).json();
  assert.equal(parent.assets.length, 3);
  assert.equal(new Set(parent.assets.map(asset => asset.id)).size, 3);
  assert.ok(parent.assets.every(asset => asset.sys === '001' && asset.contentType === 'image/webp'));
  assert.equal(Object.keys(store.saved.files).length, 3);
  assert.equal((await (await api.handle(route('digitals?summary=1'))).json()).summaries['001'].count, 3);
});

test('wrong parent, missing or discarded analytic cannot create orphan uploads', async () => {
  const { api, workspace } = setup();
  for (const body of [batch('absent'), batch('one', '002')]) assert.equal((await upload(api, body)).status, 400);
  workspace.value.state.data.analyticRecords[0].status = 'discarded';
  assert.equal((await upload(api, batch('one'))).status, 400);
  assert.deepEqual(workspace.value.assets, {});
});

test('failed storage leaves neither images nor analytic links, and stale edits are rejected', async () => {
  const { api, workspace, store } = setup();
  const original = structuredClone(workspace.value);
  store.write = async () => { throw new Error('Quota'); };
  assert.equal((await upload(api, batch('one'))).status, 400);
  assert.deepEqual(workspace.value, original);
  store.write = async () => {};
  await upload(api, batch('one'));
  const response = await api.handle(route('tree'), { method: 'POST', body: JSON.stringify({ data: original.state.data, expectedVersion: 1 }) });
  assert.equal(response.status, 409);
});

test('undoing a link keeps the image available to the parent; deleting it removes all links', async () => {
  const { api, workspace } = setup();
  const result = await (await upload(api, batch('one'))).json();
  await workspace.undo(2);
  assert.deepEqual(workspace.value.state.data.analyticRecords[0].digitalAssetIds, []);
  assert.equal((await (await api.handle(route('digitals?sys=001'))).json()).assets.length, 1);
  workspace.value.state.data.analyticRecords[0].digitalAssetIds = [result.assets[0].id];
  await api.handle(route(`digitals/${result.assets[0].id}`), { method: 'DELETE' });
  assert.deepEqual(workspace.value.state.data.analyticRecords[0].digitalAssetIds, []);
});

const source = await readFile(new URL('../assets/legacy.js', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('async function Yo('), source.indexOf('async function Ug('));
function ui(api, workspace, form) {
  let images = [], summary = {}, version = workspace.value.state.version;
  const context = vm.createContext({
    FormData, Set, $t: '001', Zt: false, L: false, Mo: form?.id,
    m: { current: workspace.value.state.data }, Ho: { current: null },
    fetch: (path, options) => api.handle(route(path.replace('/api/', '')), options),
    pl() {}, ee(value) { context.Zt = value; }, rt() {}, me() {},
    ma(fn) { images = fn(images); }, hl() {}, Gn(fn) { summary = fn(summary); },
    g() {}, E(value) { version = value; }, _e(fn) { form = fn(form); }, Yg: async () => {},
    cn() {}, setReviewOptions() {}, Dy: () => [],
  });
  vm.runInContext(`${controller};globalThis.upload=Yo`, context);
  return { upload: context.upload, get images() { return images; }, get form() { return form; }, get version() { return version; } };
}

test('the upload controller keeps an open analytic form and its version in sync', async () => {
  const { api, workspace } = setup();
  const controller = ui(api, workspace, { ...workspace.value.state.data.analyticRecords[0], title: 'Edición sin guardar' });
  await controller.upload(batch().getAll('files[]'), '001', 'one', 'one');
  assert.equal(controller.images.length, 1);
  assert.equal(controller.form.title, 'Edición sin guardar');
  assert.equal(controller.form.digitalAssetIds.length, 1);
  assert.equal(controller.version, workspace.value.state.version);
});

test('new analytic uploads remain selected until saving, without inventing a saved analytic', async () => {
  const { api, workspace } = setup();
  const controller = ui(api, workspace, { id: 'new', parentSys: '001', title: '', digitalAssetIds: [] });
  await controller.upload(batch().getAll('files[]'), '001', null, 'new');
  assert.equal(controller.form.digitalAssetIds.length, 1);
  assert.equal(workspace.value.state.data.analyticRecords.length, 2);
  assert.equal(workspace.value.state.version, 1);
});
