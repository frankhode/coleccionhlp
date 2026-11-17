import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

for (const file of await readdir('assets')) if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', `assets/${file}`]);
const tree = JSON.parse(await readFile('data/tree.json', 'utf8'));
const digitals = JSON.parse(await readFile('data/digitals.json', 'utf8'));
assert.ok(Array.isArray(tree.data.containers));
assert.ok(tree.data.boxes);
assert.ok(tree.data.bibliographicItems.length >= 685, 'La migración perdió ítems Aleph');
assert.ok(tree.data.analyticRecords.length >= 294, 'La migración perdió registros analíticos');
const assets = new Set(Object.keys(digitals.assets));
for (const analytic of tree.data.analyticRecords) for (const id of analytic.digitalAssetIds || []) assert.ok(assets.has(id), `Imagen huérfana ${id}`);
for (const asset of Object.values(digitals.assets)) assert.match(asset.path, /^images\/[^/]+\/[^/]+\.webp$/);
assert.ok(!(await readFile('index.html', 'utf8')).includes('api.php'));
for (const name of ['bna10-autoridades.json', 'tgm-completo.json']) JSON.parse(gunzipSync(await readFile(`assets/${name}.gz`)).toString('utf8'));
console.log(`Datos válidos: ${Object.keys(tree.data.boxes).length} cajas, ${tree.data.bibliographicItems.length} ítems Aleph, ${tree.data.analyticRecords.length} analíticas.`);
