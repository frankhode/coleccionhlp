import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace, createWorkspace, ConflictError } from '../assets/store.js';
import { GitHub } from '../assets/github.js';
import { BrowserAPI } from '../assets/api.js';
import { LocalImages, imagePath } from '../assets/images.js';

const actor = { name: 'Fran', role: 'admin' };
const initial = () => ({ version: 832, data: { containers: [], boxes: {}, bibliographicItems: [{ id: 'one', targetId: 'box-58' }], analyticRecords: [] }, updatedAt: '2026-11-17T00:00:00Z' });
class MemoryStore {
  async read() { return structuredClone(this.value); }
  async write(value, expectedRevision) {
    if ((this.value?.revision || 0) !== expectedRevision) throw new ConflictError();
    this.value = structuredClone(value);
  }
}
function setup() {
  const store = new MemoryStore();
  const workspace = new Workspace(store, createWorkspace(initial(), {}, 'a'.repeat(40)), actor);
  const api = new BrowserAPI({ workspace, actor, localImages: new LocalImages(), baseURL: 'https://example.test/coleccionhlp/' });
  return { store, workspace, api };
}
const route = path => new URL(`https://example.test/coleccionhlp/api.php?route=${path}`);

test('a stale tab cannot overwrite a recovered draft', async () => {
  const { workspace: first, store } = setup();
  const second = new Workspace(store, structuredClone(first.value), actor);
  await first.saveTree({ ...initial().data, contentTitles: { one: 'Nuevo título' } }, 832, 'Cambiar título');
  await assert.rejects(second.saveTree(initial().data, 832, 'Cambio desactualizado'), ConflictError);
  assert.equal(store.value.state.data.contentTitles.one, 'Nuevo título');
  assert.equal(second.value.state.version, 832);
});

test('a storage failure does not acknowledge or mutate an unsaved edit', async () => {
  const { workspace, store } = setup();
  store.write = async () => { throw new Error('Quota'); };
  await assert.rejects(workspace.saveTree(initial().data, 832, 'Cambio'), /Quota/);
  assert.equal(workspace.value.state.version, 832);
  assert.equal(workspace.value.dirty, false);
});

test('import cannot silently remove existing Aleph assignments; undo restores data', async () => {
  const { workspace } = setup();
  await assert.rejects(workspace.saveTree({ ...initial().data, bibliographicItems: [] }, 832, 'Importación Pez'), /asignaciones/);
  await workspace.saveTree({ ...initial().data, contentTitles: { a: 'Título' } }, 832, 'Título');
  const undone = await workspace.undo(833);
  assert.equal(undone.version, 834);
  assert.deepEqual(undone.data, initial().data);
});

test('public API rejects all writes and exposes no administrator', async () => {
  const api = new BrowserAPI({ published: { state: initial(), assets: {} }, localImages: new LocalImages(), baseURL: 'https://example.test/' });
  const read = await (await api.handle(route('tree'))).json();
  assert.equal(read.user.role, 'viewer');
  for (const method of ['POST', 'DELETE', 'PATCH']) assert.equal((await api.handle(route('tree'), { method })).status, 403);
});

test('pair, move, delete and undo cannot leave a stale analytic image association', async () => {
  const { workspace, api } = setup();
  workspace.value.assets = Object.fromEntries(['front', 'back'].map(id => [id, { id, sys: '001', path: `images/001/${id}.webp`, originalName: `${id}.jpg`, sortOrder: 0, createdAt: '2026', pairId: null, face: '' }]));
  workspace.value.state.data.analyticRecords = [{ id: 'analytic', digitalAssetIds: ['front', 'back'] }];
  let response = await api.handle(route('digitals/front'), { method: 'PATCH', body: JSON.stringify({ pairWith: 'back' }) });
  assert.equal(response.status, 200);
  assert.equal(workspace.value.assets.front.pairId, workspace.value.assets.back.pairId);
  response = await api.handle(route('digitals/back'), { method: 'PATCH', body: JSON.stringify({ sys: '002' }) });
  assert.equal(response.status, 200);
  assert.equal(workspace.value.assets.front.pairId, null);
  assert.deepEqual(workspace.value.state.data.analyticRecords[0].digitalAssetIds, ['front']);
  await api.handle(route('digitals/front'), { method: 'DELETE' });
  assert.deepEqual(workspace.value.state.data.analyticRecords[0].digitalAssetIds, []);
});

test('filenames are kept readable, collisions handled, and duplicate local names are not guessed', async () => {
  assert.equal(imagePath('001', 'Retrato 001.JPG'), 'images/001/Retrato 001.webp');
  assert.equal(imagePath('001', 'Retrato 001.png', new Set(['images/001/retrato 001.webp'])), 'images/001/Retrato 001-2.webp');
  assert.ok(imagePath('../../', '../x.jpg').split('/').every(part => part !== '..' && part !== '.'));
  const local = new LocalImages();
  local.add('caja 1/001.jpg', new Blob(['a'])); local.add('caja 2/001.jpg', new Blob(['b']));
  assert.equal(await local.url({ originalName: '001.jpg' }), null);
  assert.equal(local.resolvePath({ originalName: '001.jpg', originalPath: 'caja 2/001.jpg' }), 'caja 2/001.jpg');
});

test('publishing fails before uploads if another session has updated GitHub', async () => {
  const github = new GitHub('test-token', async () => { throw new Error('unexpected network'); });
  github.head = async () => 'b'.repeat(40);
  await assert.rejects(github.publish(createWorkspace(initial(), {}, 'a'.repeat(40))), ConflictError);
});

test('manual backups retain image metadata and associations after a later deletion', async () => {
  const { workspace, api } = setup();
  workspace.value.assets.front = { id: 'front', sys: '001', path: 'images/001/front.webp', originalName: 'front.jpg', sortOrder: 0, createdAt: '2026' };
  workspace.value.state.data.analyticRecords = [{ id: 'analytic', digitalAssetIds: ['front'] }];
  await api.handle(route('backups'), { method: 'POST', body: JSON.stringify({ action: 'create' }) });
  const id = workspace.value.backups[0].id;
  await api.handle(route('digitals/front'), { method: 'DELETE' });
  assert.deepEqual(workspace.value.backups[0].snapshot.analyticRecords[0].digitalAssetIds, ['front']);
  assert.ok(workspace.value.backups[0].assets.front);
  await api.handle(route('backups'), { method: 'POST', body: JSON.stringify({ action: 'restore', backupId: id }) });
  assert.ok(workspace.value.assets.front);
  assert.deepEqual(workspace.value.state.data.analyticRecords[0].digitalAssetIds, ['front']);
});

test('one commit contains tree, image metadata and new thumbnails; the branch update never forces', async () => {
  const { workspace } = setup(), calls = [];
  workspace.value.files['images/001/test.webp'] = new Blob(['webp bytes']);
  const github = new GitHub('test-token'); github.head = async () => workspace.value.baseCommit;
  github.request = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('/git/commits/') && !options) return { tree: { sha: 'tree0' } };
    return { sha: path === '/git/commits' ? 'newcommit' : 'blobortree' };
  };
  assert.equal(await github.publish(workspace.value), 'newcommit');
  const entries = calls.find(c => c.path === '/git/trees').options.body.tree;
  assert.deepEqual(entries.map(e => e.path), ['images/001/test.webp', 'data/tree.json', 'data/digitals.json']);
  assert.equal(calls.at(-1).options.body.force, false);
  assert.deepEqual(calls.find(c => c.path === '/git/commits').options.body.parents, ['a'.repeat(40)]);
});

test('an intervening branch update leaves the local draft and files intact', async () => {
  const { workspace } = setup();
  workspace.value.dirty = true;
  const github = new GitHub('test-token'); github.head = async () => workspace.value.baseCommit;
  github.request = async (path, options) => {
    if (path.startsWith('/git/commits/') && !options) return { tree: { sha: 'tree0' } };
    if (path.startsWith('/git/refs/')) throw new ConflictError();
    return { sha: 'created' };
  };
  await assert.rejects(github.publish(workspace.value), ConflictError);
  assert.equal(workspace.value.dirty, true);
  assert.equal(workspace.value.baseCommit, 'a'.repeat(40));
});


test('mixed upload review stores ordered other groups and counts a front once', async () => {
  const { workspace, api } = setup();
  for (const id of 'abcdefghi') workspace.value.assets[id] = { id, sys:'001', path:id+'.webp', sortOrder:id.charCodeAt(0), createdAt:'2026-01-01' };
  const group = groups => api.handle(route('digitals'), {method:'PATCH',body:JSON.stringify({sys:'001',groups})});
  const others = {kind:'other',ids:['c','b','a']};
  for (const bad of [{kind:'other',ids:['d']}, {kind:'other',ids:['d','c']}, {kind:'stereo',ids:['d','e']}]) {
    assert.equal((await group([others,bad])).status,400);
    assert.ok(Object.values(workspace.value.assets).every(asset=>!asset.pairId));
  }
  assert.equal((await group([others,{kind:'pairs',ids:['d','e']},{kind:'stereo',ids:['f','g','h']}])).status,200);
  const {assets} = workspace.value;
  assert.deepEqual(others.ids.map(id=>[assets[id].face,assets[id].groupOrder]),[['other-front',0],['other-detail',1],['other-detail',2]]);
  const summary = async () => (await (await api.handle(new URL('https://example.test/api/digitals?summary=1'))).json()).summaries['001'];
  const result = await summary();
  assert.equal(result.objectCount,4);
  assert.equal(result.count,9);
  assert.deepEqual(result.previews.map(asset=>asset.id),['c','d','f']);
  await api.handle(route('digitals/b'),{method:'DELETE'});
  assert.ok(workspace.value.assets.c.pairId);
  assert.equal(workspace.value.assets.c.pairId,workspace.value.assets.a.pairId);
  await api.handle(route('digitals/c'),{method:'PATCH',body:JSON.stringify({unpair:true})});
  assert.equal(workspace.value.assets.a.face,'');
  assert.equal(workspace.value.assets.a.groupOrder,undefined);
  assert.equal((await summary()).objectCount,5);
});

test('draft recovery can advance across an interface update only for an identical catalog', async () => {
  const github = new GitHub('test');
  const trees = {old:[{path:'data',type:'tree',sha:'data-A'},{path:'images',type:'tree',sha:'images-A'}]};
  trees.new = [...trees.old,{path:'assets',type:'tree',sha:'code-B'}];
  github.request = async path => path.includes('/commits/')
    ? {tree:{sha:path.split('/').pop()}} : {tree:trees[path.split('/').pop()]};
  assert.equal(await github.sameCatalog('old','new'),true);
  trees.new = [trees.old[0]];
  assert.equal(await github.sameCatalog('old','new'),false);
  trees.new = [{path:'data',type:'tree',sha:'data-B'},trees.old[1]];
  assert.equal(await github.sameCatalog('old','new'),false);
});
