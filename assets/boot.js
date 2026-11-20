import { config } from './config.js';
import { createGallery } from './gallery.js?v=20261120-gallery';
import { openDatabase, WorkspaceStore, Workspace, createWorkspace, exclusive, ConflictError } from './store.js';
import { GitHub } from './github.js';
import { LocalImages } from './images.js';
import { BrowserAPI } from './api.js';

const nativeFetch = window.fetch.bind(window);
const baseURL = new URL('./', location.href);
const admin = new URLSearchParams(location.search).has('admin');
const toolbar = document.querySelector('#hlp-toolbar');
const root = document.querySelector('#root');
const message = document.querySelector('#hlp-message');
const dialog = document.querySelector('#hlp-dialog');
const localImages = new LocalImages();
let store, workspace, github, api, folderBusy = false;
let notice = '';
const publicHref = './index.html';

function say(text = '') { message.textContent = text; message.hidden = !text; }
function button(text, handler, className = '') {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
  node.className = className; node.onclick = handler; return node;
}
function link(text, href) {
  const node = document.createElement('a'); node.textContent = text; node.href = href; return node;
}
function paragraph(text) { const node = document.createElement('p'); node.textContent = text; return node; }
function modal(title, text) {
  dialog.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = title;
  dialog.append(heading, paragraph(text));
  const actions = document.createElement('div'); actions.className = 'hlp-actions'; dialog.append(actions);
  if (!dialog.open) dialog.showModal();
  return actions;
}
function download(content, name, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob), a = link('', url); a.download = name;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function renderToolbar() {
  toolbar.replaceChildren();
  const title = document.createElement('strong'); title.textContent = admin ? 'HLP · Administración' : 'HLP · Consulta pública';
  const status = document.createElement('span'); status.className = 'hlp-status';
  const parts = [];
  if (workspace) {
    parts.push(notice || (workspace.value.dirty ? 'Borrador guardado en este navegador' : 'Sin cambios pendientes'));
    status.dataset.dirty = String(workspace.value.dirty);
  } else parts.push(admin ? 'Ingresá para editar y publicar' : 'Versión publicada');
  if (localImages.files.size) parts.push(`${localImages.files.size.toLocaleString('es-AR')} altas locales conectadas`);
  status.textContent = parts.join(' · ');
  toolbar.append(title, status);
  const folder = button(folderBusy ? 'Conectando carpeta…' : localImages.files.size ? 'Cambiar carpeta de altas' : 'Conectar carpeta de altas', connectFolder);
  folder.disabled = folderBusy; toolbar.append(folder);
  if (workspace) {
    toolbar.append(button('Borrador y respaldo', draftMenu));
    const publish = button('Publicar cambios', publishChanges, 'hlp-publish');
    publish.disabled = !workspace.value.dirty || workspace.publishing; toolbar.append(publish);
    const view = link('Ver publicación ↗', publicHref); view.target = '_blank'; view.rel = 'noopener'; toolbar.append(view);
    toolbar.append(button('Salir', () => { github.token = ''; location.assign(publicHref); }));
  } else toolbar.append(link(admin ? 'Volver a la consulta' : 'Administración', admin ? publicHref : './index.html?admin=1'));
}

async function ensureStore() {
  if (!store) store = new WorkspaceStore(await openDatabase());
  return store;
}

async function connectFolder() {
  if (folderBusy) return;
  try {
    if ('showDirectoryPicker' in window) {
      // Call the picker directly in the click handler, preserving browser user activation.
      const handle = await window.showDirectoryPicker({ id: 'hlp-altas', mode: 'read' });
      folderBusy = true; renderToolbar();
      await localImages.fromHandle(handle);
      try { await (await ensureStore()).putSetting('folder', handle); } catch { /* The selected folder still works for this session. */ }
      folderConnected();
    } else {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.onchange = () => { localImages.fromFiles([...input.files]); folderConnected(); };
      input.click();
    }
  } catch (error) {
    if (error.name !== 'AbortError') say(`No se pudo conectar la carpeta: ${error.message}`);
  } finally { folderBusy = false; renderToolbar(); }
}

function folderConnected() {
  const duplicates = localImages.duplicates;
  say(`Carpeta «${localImages.folderName}» conectada. Los originales se abren desde esta computadora. ${duplicates ? `${duplicates} nombres están repetidos: solo se abrirán cuando coincida la ruta relativa; los casos ambiguos mostrarán la miniatura.` : 'Los JPG se vinculan por su nombre de archivo.'}`);
  upgradeVisibleImages(); renderToolbar();
}

async function tryFolder() {
  try {
    const handle = await (await ensureStore()).getSetting('folder');
    if (handle && await handle.queryPermission({ mode: 'read' }) === 'granted') {
      await localImages.fromHandle(handle); renderToolbar();
    }
  } catch { /* Folder reconnection is optional; the public catalog remains usable. */ }
}

async function upgradeVisibleImages() {
  if (!api || !localImages.files.size) return;
  for (const image of document.querySelectorAll('.digital-viewer-image')) {
    const asset = Object.values(api.value.assets).find(a => new URL(a.path, baseURL).href === image.src || api.objectURLs.get(a.path) === image.src);
    if (asset) {
      const previous = image.src;
      const local = await localImages.url(asset);
      if (local && image.src === previous) image.src = local;
    }
  }
}

function installBridge() {
  window.fetch = (input, options = {}) => {
    const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(value, location.href);
    if ((url.origin === location.origin) && (url.pathname.startsWith('/api/') || url.pathname.endsWith('/api.php'))) return api.handle(url, options);
    const vocabulary = ['bna10-autoridades.json', 'tgm-completo.json'].find(name => url.origin === location.origin && url.pathname.endsWith('/' + name));
    if (vocabulary) return (async () => {
      const response = await nativeFetch(new URL(`assets/${vocabulary}.gz`, baseURL), options);
      if (!response.ok) throw new Error('No se pudo cargar el vocabulario. Recargá e intentá otra vez.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const body = bytes[0] === 0x1f && bytes[1] === 0x8b
        ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')) : bytes;
      return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    })();
    if (typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')) return nativeFetch(new URL(input.slice(1), baseURL), options);
    return nativeFetch(input, options);
  };
  document.addEventListener('click', async event => {
    const anchor = event.target.closest('a');
    if (!anchor || !anchor.getAttribute('href')?.includes('api.php?route=backups')) return;
    event.preventDefault();
    const value = api.value.state;
    download(JSON.stringify({ format: 'hlp-tree-backup', exportedAt: new Date().toISOString(), version: value.version, data: value.data }), `hlp-respaldo-v${value.version}.json`);
  });
  new MutationObserver(() => { upgradeVisibleImages(); }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  // If a local file becomes unavailable while a viewer is open, keep the thumbnail usable.
  root.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('digital-viewer-image')) return;
    const placeholder = image.parentElement?.querySelector('.digital-viewer-placeholder');
    if (placeholder && image.src !== placeholder.src) {
      say('No se pudo abrir el original local. Se muestra la miniatura publicada.');
      image.src = placeholder.src;
    }
  }, true);
}

async function mount() {
  installBridge();
  window.HLP_PUBLIC = !admin;
  window.HLP_CREATE_GALLERY = createGallery;
  window.HLP_LOCAL_IMAGE = image => localImages.url(api.value.assets[image.id] || image);
  const script = document.createElement('script'); script.src = new URL('assets/legacy.js?v=20261120-gallery', baseURL);
  script.onload = () => window.HLP_MOUNT();
  script.onerror = () => say('No se pudo cargar la interfaz. Recargá la página.');
  document.body.append(script);
  renderToolbar();
  await tryFolder();
}

async function loadPublic() {
  const [stateResponse, digitalResponse] = await Promise.all([
    nativeFetch(new URL('data/tree.json', baseURL), { cache: 'no-store' }),
    nativeFetch(new URL('data/digitals.json', baseURL), { cache: 'no-store' }),
  ]);
  if (!stateResponse.ok || !digitalResponse.ok) throw new Error('No se pudieron leer los datos publicados. Recargá la página.');
  const state = await stateResponse.json(), digitals = await digitalResponse.json();
  api = new BrowserAPI({ published: { state, assets: digitals.assets, files: {} }, localImages, baseURL });
  await mount();
}

function login() {
  root.replaceChildren();
  const card = document.createElement('section'); card.className = 'hlp-login';
  const heading = document.createElement('h1'); heading.textContent = 'Administrar Colección HLP';
  card.append(heading, paragraph('Editá la colección, guardá un borrador en este navegador y publicá cuando esté listo.'));
  const form = document.createElement('form');
  const label = document.createElement('label'); label.htmlFor = 'hlp-token'; label.textContent = 'Token de GitHub';
  const input = document.createElement('input'); input.id = 'hlp-token'; input.type = 'password'; input.autocomplete = 'off'; input.required = true; input.spellcheck = false;
  const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Ingresar';
  const note = document.createElement('small'); note.textContent = 'El token permanece solo en esta sesión; tendrás que ingresarlo de nuevo al recargar. Elegí un token de acceso detallado para frankhode/coleccionhlp con Contents: Read and write.';
  const error = paragraph(''); error.setAttribute('role', 'alert');
  const tokenHelp = link('Crear token en GitHub ↗', 'https://github.com/settings/personal-access-tokens/new'); tokenHelp.target = '_blank'; tokenHelp.rel = 'noopener';
  form.append(label, input, submit, note, error);
  card.append(form, paragraph('La consulta es pública. La autorización de escritura la verifica GitHub; el contenido publicado del repositorio es accesible al público.'), tokenHelp, paragraph(''), link('Volver a la consulta', publicHref)); root.append(card);
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true; error.textContent = 'Comprobando acceso…';
    try {
      github = new GitHub(input.value.trim(), nativeFetch);
      const actor = await github.authenticate();
      input.value = '';
      const head = await github.head();
      const database = await ensureStore();
      let saved = await database.read();
      if (saved?.dirty) {
        error.textContent = '';
        if (saved.baseCommit !== head && await github.sameCatalog(saved.baseCommit, head).catch(() => false)) {
          saved = { ...saved, baseCommit: head };
        }
        saved = await chooseDraft(saved, head);
      } else saved = null;
      const published = saved || createWorkspace(...await (async () => { const p = await github.load(head); return [p.state, p.assets, head]; })());
      // Reserve a revision immediately, so competing tabs cannot silently replace drafts.
      if (!saved) {
        const prior = await database.read();
        published.revision = (prior?.revision || 0) + 1;
        await database.write(published, prior?.revision || 0);
      }
      workspace = new Workspace(database, published, actor, renderToolbar);
      api = new BrowserAPI({ workspace, actor, localImages, baseURL });
      if (saved && saved.baseCommit !== head) say('Se recuperó un borrador basado en una versión anterior de GitHub. Podés revisarlo y exportarlo; la publicación está bloqueada hasta resolver esa diferencia.');
      await mount();
      navigator.storage?.persist?.().catch(() => {});
    } catch (failure) {
      input.value = ''; if (github) github.token = '';
      error.textContent = failure.message; submit.disabled = false;
    }
  };
}

function chooseDraft(saved, head) {
  return new Promise(resolve => {
    const actions = modal('Hay un borrador guardado', `Último cambio: ${new Date(saved.changedAt).toLocaleString('es-AR')}.${saved.baseCommit !== head ? ' GitHub tiene cambios posteriores: podés recuperar y exportar este borrador, pero no sobrescribir la versión nueva.' : ''}`);
    const onClose = () => resolve(saved);
    dialog.addEventListener('close', onClose, { once: true });
    actions.append(button('Recuperar borrador', () => { dialog.removeEventListener('close', onClose); dialog.close(); resolve(saved); }));
    actions.append(button('Exportar borrador', () => exportDraft(saved), 'hlp-secondary'));
    actions.append(button('Descartar y cargar GitHub', () => {
      if (!confirm('¿Descartar el borrador guardado en este navegador y cargar la versión de GitHub?')) return;
      dialog.removeEventListener('close', onClose); dialog.close(); resolve(null);
    }, 'hlp-secondary'));
  });
}

async function exportDraft(value = workspace.value) {
  try {
    const files = {};
    for (const [path, blob] of Object.entries(value.files)) {
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      files[path] = btoa(binary);
    }
    download(JSON.stringify({ format: 'hlp-github-draft', exportedAt: new Date().toISOString(), repository: `${config.owner}/${config.repository}`, baseCommit: value.baseCommit, state: value.state, assets: value.assets, files }), `hlp-borrador-v${value.state.version}.json`);
  } catch (error) { say(`No se pudo exportar: ${error.message}`); }
}

function draftMenu() {
  const pending = Object.keys(workspace.value.files).length;
  const actions = modal('Borrador y respaldo', `Los cambios se guardan automáticamente en este navegador. Hay ${pending} miniaturas nuevas pendientes de publicar. Exportá el borrador para llevarlo a otra computadora o conservar una copia. La exportación incluye los datos y las miniaturas nuevas; las ya publicadas permanecen en GitHub. Los respaldos del panel interno contienen solo el árbol.`);
  actions.append(button('Exportar borrador', () => exportDraft()));
  actions.append(button('Importar borrador', importDraft, 'hlp-secondary'));
  actions.append(button('Recargar versión de GitHub', resetDraft, 'hlp-secondary'));
  actions.append(button('Cerrar', () => dialog.close(), 'hlp-secondary'));
}

async function resetDraft() {
  if (!confirm('¿Descartar los cambios locales y recuperar la versión publicada en GitHub? Exportá el borrador antes si querés conservarlo.')) return;
  try {
    const head = await github.head(), loaded = await github.load(head);
    const next = createWorkspace(loaded.state, loaded.assets, head); next.revision = workspace.value.revision + 1;
    await store.write(next, workspace.value.revision);
    location.reload();
  } catch (error) { say(error.message); }
}

function importDraft() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'hlp-github-draft' || data.repository !== `${config.owner}/${config.repository}` || !Array.isArray(data.state?.data?.containers) || !data.state.data.boxes || !data.assets || !/^[a-f0-9]{40}$/.test(data.baseCommit)) throw new Error('El archivo no es un borrador válido de coleccionhlp.');
      const files = {};
      const validPath = path => /^images\/[^/]+\/[^/]+\.webp$/u.test(path) && !path.split('/').some(p => p === '.' || p === '..');
      for (const asset of Object.values(data.assets)) if (!validPath(asset.path)) throw new Error('El borrador contiene rutas de imagen inválidas.');
      for (const [path, encoded] of Object.entries(data.files || {})) {
        if (!validPath(path)) throw new Error('El borrador contiene rutas de imagen inválidas.');
        const binary = atob(encoded), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        if (bytes.length > 2_000_000 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') throw new Error('El borrador contiene una miniatura WebP inválida.');
        files[path] = new Blob([bytes], { type: 'image/webp' });
      }
      if (!confirm('¿Reemplazar el borrador actual por el archivo seleccionado?')) return;
      await workspace.mutate(next => {
        next.baseCommit = data.baseCommit; next.state = data.state; next.assets = data.assets; next.files = files; next.history = []; next.backups = [];
      });
      location.reload();
    } catch (error) { say(`No se pudo importar: ${error.message}`); }
  };
  input.click();
}

function publishChanges() {
  if (!workspace.value.dirty || workspace.publishing) return;
  const count = Object.keys(workspace.value.assets).length, pending = Object.keys(workspace.value.files).length;
  const actions = modal('Publicar cambios', `Se publicará la versión ${workspace.value.state.version} con ${count} imágenes (${pending} miniaturas nuevas). Los datos y las miniaturas quedarán disponibles en la consulta pública. Los JPG de la carpeta local permanecen en tu computadora.`);
  actions.append(button('Publicar ahora', async () => {
    dialog.close(); workspace.publishing = true; notice = 'Publicando…'; renderToolbar();
    try {
      await exclusive(async () => {
        const current = await store.read();
        if ((current?.revision || 0) !== workspace.value.revision) throw new ConflictError('Otra pestaña cambió el borrador. Recargá antes de publicar.');
        const sha = await github.publish(workspace.value, text => { notice = text; renderToolbar(); });
        const next = structuredClone(workspace.value);
        next.baseCommit = sha; next.dirty = false; next.revision++; next.publishedAt = new Date().toISOString();
        // Existing object URLs keep this session's preview visible while Pages deploys.
        next.files = {};
        await store.write(next, workspace.value.revision); workspace.value = next;
      });
      say('Los cambios ya están guardados en GitHub. GitHub Pages actualizará la consulta cuando termine su despliegue.');
    } catch (error) { say(`${error.message} Tu borrador se conserva en este navegador.`); }
    finally { workspace.publishing = false; notice = ''; renderToolbar(); }
  }));
  actions.append(button('Cancelar', () => dialog.close(), 'hlp-secondary'));
}

window.addEventListener('beforeunload', event => {
  if (workspace?.publishing) { event.preventDefault(); event.returnValue = ''; }
});

renderToolbar();
if (admin) login();
else loadPublic().catch(error => { root.replaceChildren(paragraph(error.message)); say(error.message); });

