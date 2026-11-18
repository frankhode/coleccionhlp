import { imagePath, thumbnail } from './images.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const copy = value => structuredClone(value);

export class BrowserAPI {
  constructor({ workspace, published, actor, localImages, baseURL }) {
    Object.assign(this, { workspace, published, actor, localImages, baseURL });
    this.objectURLs = new Map();
  }

  get value() { return this.workspace?.value || this.published; }

  async asset(asset) {
    const pending = this.value.files?.[asset.path];
    let preview = new URL(asset.path, this.baseURL).href;
    if (pending || this.objectURLs.has(asset.path)) {
      if (!this.objectURLs.has(asset.path)) this.objectURLs.set(asset.path, URL.createObjectURL(pending));
      preview = this.objectURLs.get(asset.path);
    }
    // Original JPGs are opened locally and are never uploaded by connecting a folder.
    // Resolve originals only for the active viewer in boot.js. Eagerly reading all
    // connected JPGs here would exhaust memory when listing a large collection.
    return { ...asset, thumbnailUrl: preview, url: preview };
  }

  async list(sys = null) {
    const assets = Object.values(this.value.assets).filter(a => sys === null || a.sys === sys);
    assets.sort((a, b) => a.sys.localeCompare(b.sys) || a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    return Promise.all(assets.map(a => this.asset(a)));
  }

  unpair(value, pairId) {
    if (pairId) for (const asset of Object.values(value.assets)) {
      if (asset.pairId === pairId) { asset.pairId = null; asset.face = ''; delete asset.groupOrder; }
    }
  }

  detach(value, asset) {
    if (asset.face === 'other-detail') {
      const members = Object.values(value.assets).filter(item => item.pairId === asset.pairId);
      if (members.length > 2) {
        asset.pairId = null;
        asset.face = '';
        delete asset.groupOrder;
        return;
      }
    }
    this.unpair(value, asset.pairId);
  }

  async saveGroups(sys, groups) {
    if (!sys || !Array.isArray(groups) || !groups.length) throw new Error('Elegí las imágenes de la pieza.');
    await this.workspace.mutate(next => {
      for (const { kind, ids } of groups) {
        if (!Array.isArray(ids) || !['pairs', 'stereo', 'other'].includes(kind) ||
            ids.length < 2 || (kind === 'pairs' && ids.length !== 2) || (kind === 'stereo' && ids.length !== 3)) {
          throw new Error('La cantidad de imágenes no corresponde al grupo.');
        }
        const groupId = crypto.randomUUID();
        ids.forEach((id, index) => {
          const asset = next.assets[id];
          if (!asset || asset.sys !== sys || asset.pairId) throw new Error('Elegí imágenes sueltas y diferentes del mismo registro.');
          asset.pairId = groupId;
          if (kind === 'other') {
            asset.face = index === 0 ? 'other-front' : 'other-detail';
            asset.groupOrder = index;
          } else {
            asset.face = (kind === 'pairs' ? ['front', 'back'] : ['stereo-full', 'stereo-left', 'stereo-right'])[index];
          }
        });
      }
    });
    return this.list(sys);
  }

  async handle(url, options = {}) {
    try {
      const method = (options.method || 'GET').toUpperCase();
      if (method !== 'GET' && !this.workspace) return json({ error: 'Ingresá a Administración para editar.' }, 403);
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
      const route = url.pathname.includes('/api/') ? url.pathname.split('/api/')[1] : url.searchParams.get('route');
      const [resource, id, action] = route.replace(/^\/+|\/+$/g, '').split('/');
      const value = this.value;

      if (resource === 'tree') {
        if (method === 'GET') return json({ state: value.state, history: (value.history || []).slice().reverse().map(({ snapshot, ...row }) => row), user: this.actor || { name: 'Consulta pública', role: 'viewer' } });
        if (method === 'POST') return json(await this.workspace.saveTree(body.data, body.expectedVersion, body.action || 'Modificación del árbol'));
        if (method === 'DELETE') return json(await this.workspace.undo(body.expectedVersion));
      }

      if (resource === 'backups') {
        if (method === 'GET') {
          if (url.searchParams.get('download') === 'current') return json({ format: 'hlp-tree-backup', exportedAt: new Date().toISOString(), version: value.state.version, data: value.state.data });
          return json({ backups: (value.backups || []).slice().reverse().map(({ snapshot, assets, files, ...row }) => ({ ...row, bytes: JSON.stringify(snapshot).length })), currentVersion: value.state.version });
        }
        if (method === 'POST' && body.action === 'create') {
          await this.workspace.mutate(next => this.workspace.snapshot(next, body.label || 'Respaldo local', 'manual'));
          return json({ ok: true });
        }
        if (method === 'POST' && body.action === 'restore') {
          await this.workspace.mutate(next => {
            const backup = body.backupId ? next.backups.find(b => b.id === body.backupId) : null;
            const data = backup?.snapshot || (body.data?.format === 'hlp-tree-backup' ? body.data.data : null);
            if (!data || !Array.isArray(data.containers) || !data.boxes) throw new Error('El respaldo no contiene un árbol HLP válido.');
            this.workspace.snapshot(next, 'Antes de restaurar', 'pre_restore');
            next.history.push({ id: crypto.randomUUID(), action: 'Restauración de respaldo', snapshot: copy(next.state.data), created_at: new Date().toISOString(), created_by: this.actor.name });
            next.history = next.history.slice(-12);
            next.state = { version: next.state.version + 1, data, updatedAt: new Date().toISOString(), updatedBy: this.actor.name };
            if (backup) { next.assets = copy(backup.assets); next.files = copy(backup.files); }
            for (const analytic of next.state.data.analyticRecords || []) analytic.digitalAssetIds = (analytic.digitalAssetIds || []).filter(id => next.assets[id]);
          });
          return json({ ok: true, version: this.value.state.version });
        }
      }

      if (resource === 'users') {
        if (method === 'GET') return json({ users: this.actor ? [this.actor] : [] });
        return json({ error: 'El acceso de edición se administra en GitHub: colaborador del repositorio y token con permiso de escritura. No se crean cuentas desde este panel.' }, 400);
      }

      if (resource === 'health' && method === 'GET') {
        const containers = value.state.data.containers;
        const boxes = Object.values(value.state.data.boxes);
        const ids = new Set(containers.map(c => c.id));
        return json({ status: 'ok', version: value.state.version, updatedAt: value.state.updatedAt, boxes: boxes.length, containers: containers.length, orphanBoxes: boxes.filter(b => b.parentId && b.parentId !== 'collection-root' && !ids.has(b.parentId)).length, errors: [] });
      }

      if (resource === 'digitals') {
        if (id && !value.assets[id]) return json({ error: 'Digitalización inexistente.' }, 404);
        if (method === 'GET') {
          if (id) {
            const asset = await this.asset(value.assets[id]);
            if (['file', 'thumbnail'].includes(action)) return Response.redirect(action === 'file' ? asset.url : asset.thumbnailUrl);
            return json({ asset });
          }
          if (url.searchParams.get('summary') === '1') {
            const summaries = {};
            // Only resolve the first three thumbnail URLs for each record.
            for (const asset of Object.values(value.assets).sort((a, b) => a.sortOrder - b.sortOrder)) {
              const summary = summaries[asset.sys] ||= { count: 0, objectCount: 0, previews: [] };
              summary.count++;
              if (!['back', 'stereo-left', 'stereo-right', 'other-detail'].includes(asset.face)) {
                summary.objectCount++;
                if (summary.previews.length < 3) summary.previews.push(await this.asset(asset));
              }
            }
            return json({ summaries });
          }
          return json({ assets: await this.list(url.searchParams.get('all') === '1' ? null : (url.searchParams.get('sys') || '')) });
        }
        if (method === 'POST' && options.body instanceof FormData) {
          const sys = options.body.get('sys')?.trim();
          const analyticId = options.body.get('analyticId')?.trim();
          const findAnalytic = state => (state.data.analyticRecords || []).find(record => record.id === analyticId);
          const validateAnalytic = state => {
            const analytic = findAnalytic(state);
            if (!analytic || analytic.parentSys !== sys || analytic.status === 'discarded') throw new Error('La analítica no existe o no pertenece al registro seleccionado.');
            return analytic;
          };
          if (analyticId) validateAnalytic(value.state);
          const files = [...options.body.getAll('files'), ...options.body.getAll('files[]')];
          if (!sys || !files.length || files.length > 20) throw new Error('Elegí un registro y entre 1 y 20 imágenes.');
          // Convert the complete batch before changing metadata; a failure leaves no partial batch.
          const converted = [];
          for (const file of files) converted.push({ file, ...await thumbnail(file) });
          const createdIds = [];
          await this.workspace.mutate(next => {
            // Revalidate after conversion, in case another edit changed the target.
            const analytic = analyticId ? validateAnalytic(next.state) : null;
            const used = new Set(Object.values(next.assets).map(a => a.path.toLocaleLowerCase('es')));
            let order = Math.max(-1, ...Object.values(next.assets).filter(a => a.sys === sys).map(a => a.sortOrder));
            for (const { file, blob, width, height } of converted) {
              const id = crypto.randomUUID();
              const path = imagePath(sys, file.name, used); used.add(path.toLocaleLowerCase('es'));
              next.files[path] = blob;
              next.assets[id] = { id, sys, originalName: file.name, originalPath: file.webkitRelativePath?.split('/').slice(1).join('/') || '', path, contentType: 'image/webp', sizeBytes: blob.size, originalSizeBytes: file.size, width, height, sortOrder: ++order, label: '', pairId: null, face: '', createdAt: new Date().toISOString(), createdBy: this.actor.name };
              createdIds.push(id);
            }
            if (analytic) {
              next.history.push({ id: crypto.randomUUID(), action: `Carga de imágenes en analítica: ${analytic.title}`, snapshot: copy(next.state.data), created_at: new Date().toISOString(), created_by: this.actor.name });
              next.history = next.history.slice(-12);
              analytic.digitalAssetIds = [...new Set([...(analytic.digitalAssetIds || []), ...createdIds])];
              analytic.updatedAt = new Date().toISOString();
              next.state = { ...next.state, version: next.state.version + 1, updatedAt: analytic.updatedAt, updatedBy: this.actor.name };
            }
          });
          return json({ assets: await Promise.all(createdIds.map(id => this.asset(this.value.assets[id]))), ...(analyticId ? { analytic: findAnalytic(this.value.state), version: this.value.state.version } : {}) }, 201);
        }
        if (method === 'DELETE' && id) {
          await this.workspace.mutate(next => {
            this.detach(next, next.assets[id]);
            delete next.files[next.assets[id].path];
            delete next.assets[id];
            for (const analytic of next.state.data.analyticRecords || []) analytic.digitalAssetIds = (analytic.digitalAssetIds || []).filter(a => a !== id);
          });
          return json({ ok: true });
        }
        if (method === 'PATCH' && !id) return json({ assets: await this.saveGroups(body.sys, body.groups) });
        if (method === 'PATCH' && id) {
          await this.workspace.mutate(next => {
            const asset = next.assets[id];
            if (body.unpair) { this.unpair(next, asset.pairId); return; }
            if (body.pairWith || body.stereoWith) {
              const ids = body.pairWith ? [id, body.pairWith] : [id, ...body.stereoWith];
              const faces = body.pairWith ? ['front', 'back'] : ['stereo-full', 'stereo-left', 'stereo-right'];
              if (new Set(ids).size !== faces.length || ids.length !== faces.length || ids.some(key => !next.assets[key] || next.assets[key].sys !== asset.sys)) throw new Error('Elegí imágenes diferentes del mismo registro.');
              for (const key of ids) this.detach(next, next.assets[key]);
              const group = crypto.randomUUID();
              ids.forEach((key, i) => { next.assets[key].pairId = group; next.assets[key].face = faces[i]; });
              return;
            }
            const sys = body.sys?.trim();
            if (!sys) throw new Error('Elegí el registro de destino.');
            if (sys !== asset.sys) {
              this.detach(next, asset);
              for (const analytic of next.state.data.analyticRecords || []) analytic.digitalAssetIds = (analytic.digitalAssetIds || []).filter(a => a !== id);
              asset.sys = sys;
              asset.sortOrder = Math.max(-1, ...Object.values(next.assets).filter(a => a.sys === sys && a.id !== id).map(a => a.sortOrder)) + 1;
            }
          });
          return json(body.sys ? { asset: await this.asset(this.value.assets[id]) } : { assets: await this.list(this.value.assets[id].sys) });
        }
      }
      return json({ error: 'Método o ruta no permitido.' }, 405);
    } catch (error) { return json({ error: error.message }, error.status || 400); }
  }
}

