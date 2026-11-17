const DB_NAME = 'coleccion-hlp-github-v1';
const KEY = 'frankhode/coleccionhlp/main';

export const exclusive = fn => globalThis.navigator?.locks
  ? navigator.locks.request('hlp-workspace-write', fn)
  : fn();

export class ConflictError extends Error {
  constructor(message = 'Hay cambios de otra sesión. Recargá antes de continuar.') {
    super(message);
    this.status = 409;
  }
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento del navegador.'));
  });
}

export class WorkspaceStore {
  constructor(db) { this.db = db; }

  async read(key = KEY) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('workspace', 'readonly');
      const request = tx.objectStore('workspace').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // The read and guarded write share one IndexedDB transaction, including across tabs.
  async write(value, expectedRevision, key = KEY) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('workspace', 'readwrite');
      const store = tx.objectStore('workspace');
      let conflict = false;
      const request = store.get(key);
      request.onsuccess = () => {
        if ((request.result?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(value, key);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(conflict ? new ConflictError('El borrador cambió en otra pestaña. Recargá esta página.') : new Error('No se pudo guardar el borrador. Revisá el espacio disponible del navegador.'));
      tx.onerror = () => {};
    });
  }

  async putSetting(key, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(value, `setting:${key}`);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  }

  getSetting(key) { return this.read(`setting:${key}`); }
}

export function createWorkspace(state, assets, baseCommit) {
  return {
    revision: 0, baseCommit, state, assets, files: {}, history: [], backups: [],
    dirty: false, changedAt: null, publishedAt: state.updatedAt,
  };
}

export class Workspace {
  constructor(store, value, actor, changed = () => {}) {
    this.store = store;
    this.value = value;
    this.actor = actor;
    this.changed = changed;
    this.publishing = false;
  }

  async mutate(fn) {
    if (this.publishing) throw new Error('Esperá a que termine la publicación.');
    return exclusive(async () => {
    const next = structuredClone(this.value);
    const result = await fn(next);
    next.revision++;
    next.dirty = true;
    next.changedAt = new Date().toISOString();
    await this.store.write(next, this.value.revision);
    this.value = next;
    this.changed();
    return result;
    });
  }

  async saveTree(data, expectedVersion, action) {
    return this.mutate(value => {
      if (expectedVersion !== value.state.version) throw new ConflictError();
      if (!data || typeof data !== 'object' || !Array.isArray(data.containers) || !data.boxes) {
        throw new Error('El archivo no contiene un árbol HLP válido.');
      }
      if (/^Importación Pez/u.test(action)) {
        const assigned = d => (d.bibliographicItems ?? []).filter(item => item.targetId).length;
        if (assigned(data) < assigned(value.state.data)) throw new Error('Importación detenida: reduciría las asignaciones existentes.');
      }
      if (/^Importación/u.test(action)) this.snapshot(value, `Antes de ${action}`, 'pre_import');
      for (const analytic of data.analyticRecords || []) analytic.digitalAssetIds = (analytic.digitalAssetIds || []).filter(id => value.assets[id]);
      value.history.push({ id: crypto.randomUUID(), action, snapshot: structuredClone(value.state.data), created_at: new Date().toISOString(), created_by: this.actor.name });
      value.history = value.history.slice(-12);
      value.state = { version: value.state.version + 1, data, updatedAt: new Date().toISOString(), updatedBy: this.actor.name };
      const { data: ignored, ...metadata } = value.state;
      return metadata;
    });
  }

  snapshot(value, label, kind = 'manual') {
    value.backups.push({ id: crypto.randomUUID(), label, kind, version: value.state.version, snapshot: structuredClone(value.state.data), assets: structuredClone(value.assets), files: structuredClone(value.files), created_at: new Date().toISOString(), created_by: this.actor.name });
    value.backups = value.backups.slice(-5);
  }

  async undo(expectedVersion) {
    return this.mutate(value => {
      if (expectedVersion !== value.state.version) throw new ConflictError();
      const previous = value.history.pop();
      if (!previous) throw new Error('Todavía no hay cambios para deshacer en este navegador.');
      value.state = { ...value.state, version: value.state.version + 1, data: previous.snapshot, updatedAt: new Date().toISOString(), updatedBy: this.actor.name };
      for (const analytic of value.state.data.analyticRecords || []) analytic.digitalAssetIds = (analytic.digitalAssetIds || []).filter(id => value.assets[id]);
      return { ...value.state, undone: previous.action };
    });
  }
}
