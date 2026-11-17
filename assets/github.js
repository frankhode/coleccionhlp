import { config } from './config.js';
import { ConflictError } from './store.js';

const ROOT = `https://api.github.com/repos/${config.owner}/${config.repository}`;

export class GitHub {
  constructor(token, fetcher = globalThis.fetch.bind(globalThis)) {
    this.token = token;
    this.fetcher = fetcher;
  }

  async request(path, { method = 'GET', body, absolute = false, raw = false } = {}) {
    const response = await this.fetcher(absolute ? `https://api.github.com${path}` : `${ROOT}${path}`, {
      method,
      headers: {
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('El token no es válido o venció. Volvé a ingresar.');
      if (response.status === 403) throw new Error('GitHub rechazó la operación. Revisá los permisos Contents: Read and write del token y el límite de solicitudes.');
      if (response.status === 409 || response.status === 422) throw new ConflictError('GitHub cambió o rechazó la publicación. Tu borrador sigue guardado.');
      throw new Error(`GitHub respondió ${response.status}: ${detail.message || 'no se pudo completar la operación'}`);
    }
    return response.json();
  }

  async authenticate() {
    const [user, repository] = await Promise.all([
      this.request('/user', { absolute: true }), this.request(''),
    ]);
    if (repository.permissions?.push !== true) throw new Error('Esta cuenta no tiene permiso para escribir en coleccionhlp.');
    return { email: user.email || user.login, name: user.name || user.login, role: 'admin' };
  }

  async head() { return (await this.request(`/git/ref/heads/${config.branch}`)).object.sha; }

  async readAt(path, sha) {
    return this.request(`/contents/${path}?ref=${encodeURIComponent(sha)}`, { raw: true });
  }

  async load(sha) {
    const [state, digitals] = await Promise.all([this.readAt('data/tree.json', sha), this.readAt('data/digitals.json', sha)]);
    return { state, assets: digitals.assets };
  }

  async publish(workspace, progress = () => {}) {
    const current = await this.head();
    if (current !== workspace.baseCommit) throw new ConflictError('Hay una versión nueva en GitHub. Descargá tu borrador antes de recargar; no se sobrescribió ningún cambio.');
    const commit = await this.request(`/git/commits/${current}`);
    const changes = [
      ['data/tree.json', JSON.stringify(workspace.state) + '\n'],
      ['data/digitals.json', JSON.stringify({ assets: workspace.assets }) + '\n'],
    ];
    const tree = [];
    const files = Object.entries(workspace.files);
    for (let i = 0; i < files.length; i++) {
      const [path, blob] = files[i];
      progress(`Publicando miniatura ${i + 1} de ${files.length}…`);
      const binary = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (let offset = 0; offset < binary.length; offset += 16384) text += String.fromCharCode(...binary.subarray(offset, offset + 16384));
      const created = await this.request('/git/blobs', { method: 'POST', body: { content: btoa(text), encoding: 'base64' } });
      tree.push({ path, mode: '100644', type: 'blob', sha: created.sha });
    }
    // Metadata and thumbnails enter the branch in a single commit.
    for (const [path, content] of changes) tree.push({ path, mode: '100644', type: 'blob', content });
    const createdTree = await this.request('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
    const createdCommit = await this.request('/git/commits', { method: 'POST', body: { message: `Publicar HLP · versión ${workspace.state.version}`, tree: createdTree.sha, parents: [current] } });
    // force:false prevents replacing another editor's intervening commit.
    await this.request(`/git/refs/heads/${config.branch}`, { method: 'PATCH', body: { sha: createdCommit.sha, force: false } });
    return createdCommit.sha;
  }
}
