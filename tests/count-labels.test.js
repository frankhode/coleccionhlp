import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/legacy.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const functions = [
  section('function Uc(', 'function dg('),
  section('const defaultCountLabel', 'function CountLabelEditor'),
  section('function updateGroupedImages(', 'async function Ug('),
].join('\n');

test('a record updates its count and previews when grouping changes', () => {
  let summaries = {other:{count:1}};
  const context = vm.createContext({ma() {}, hl() {}, Gn(update) { summaries = update(summaries); }});
  vm.runInContext(functions, context);
  const images = ['front','back','front','back','front','back',''].map((face,id) => ({sys:'001',id,face}));
  context.updateGroupedImages(images);
  const summary = summaries['001'];
  assert.equal(context.digitalCaption(summary.objectCount,summary.count),'4 fotografías (7 imágenes)');
  assert.deepEqual(Array.from(summary.previews, item => item.id),[0,2,4]);
  assert.equal(summaries.other.count,1);
  images[0].face = images[1].face = '';
  context.updateGroupedImages(images);
  assert.equal(summaries['001'].objectCount,5);
  context.updateGroupedImages(['stereo-full','stereo-left','stereo-right'].map(face => ({sys:'001',face})));
  assert.equal(summaries['001'].objectCount,1);
});

test('record captions support singular, plural and hiding the file count', () => {
  const context = vm.createContext({});
  vm.runInContext(functions,context);
  const label = {singular:'postal',plural:'postales'};
  assert.equal(context.digitalCaption(1,2,label),'1 postal (2 imágenes)');
  assert.equal(context.digitalCaption(4,7,{...label,showImages:false}),'4 postales');
  assert.equal(context.digitalCaption(2,2,label),'2 postales');
  assert.equal(context.digitalCaption(1,1),'1 fotografía');
});
