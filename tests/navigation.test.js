import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/legacy.js', import.meta.url), 'utf8');
const navigation = source.slice(source.indexOf('function resetCatalogSearch('), source.indexOf('function Dy('));
function setup() {
  const state = { query: 'caballos', author: 'Autor anterior', subject: 'Tema anterior', genre: 'Anterior',
    from: '1900', to: '1910', imageMode: 'without', analytics: true, record: null, view: 'gallery', viewer: 2 };
  const setters = { ot: 'query', Q: 'author', Mt: 'subject', Ie: 'subjectKind', Re: 'genre', Fe: 'from', Ta: 'to',
    Ea: 'imageMode', kn: 'analytics', pl: 'record', Ae: 'viewer', mg: 'menu', gg: 'facet', Je: 'view' };
  const context = vm.createContext({ xe: 'gallery', requestAnimationFrame: callback => callback(),
    document: { querySelector: () => null }, ...Object.fromEntries(Object.entries(setters).map(([name, key]) => [name, value => { state[key] = value; }])) });
  vm.runInContext(navigation, context);
  return { state, context };
}
test('opening a linked parent clears every criterion that could hide the requested record', () => {
  const { state, context } = setup();
  context.openBibliography('001671381');
  assert.equal(state.view, 'catalog');
  assert.equal(state.record, '001671381');
  for (const key of ['query', 'author', 'subject', 'genre', 'from', 'to']) assert.equal(state[key], '');
  assert.equal(state.imageMode, 'all');
  assert.equal(state.analytics, false);
  assert.equal(state.viewer, null);
});
test('changing views starts a fresh search, while clicking the current view retains it', () => {
  const { state, context } = setup();
  context.changeView('gallery');
  assert.equal(state.query, 'caballos');
  context.changeView('explore');
  assert.equal(state.query, '');
  assert.equal(state.author, '');
  assert.equal(state.view, 'explore');
  assert.equal(state.record, null);
});
