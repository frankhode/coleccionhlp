// Readable gallery components, using the React runtime already bundled with HLP.
const secondaryFaces = new Set(['back', 'stereo-left', 'stereo-right', 'other-detail']);
const faceNames = { front: 'Frente', back: 'Reverso', 'other-front': 'Frente',
  'other-detail': 'Complementaria', 'stereo-full': 'Completa',
  'stereo-left': 'Izquierda', 'stereo-right': 'Derecha' };
const cleanTerm = value => value.replace(/\s+Fotografías[.,;:]?$/i, '').replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values.filter(Boolean))];

export function galleryEntries(records, assets, analytics = []) {
  const byRecord = new Map(), groups = new Map(), descriptions = new Map(), describedRecords = new Set();
  for (const asset of assets) {
    if (!byRecord.has(asset.sys)) byRecord.set(asset.sys, []);
    byRecord.get(asset.sys).push(asset);
    if (asset.pairId) {
      const key = `${asset.sys}:${asset.pairId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(asset);
    }
  }
  for (const analytic of [...analytics].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))) {
    if ((analytic.status ?? 'published') !== 'published') continue;
    describedRecords.add(analytic.parentSys);
    for (const id of analytic.digitalAssetIds || []) {
      const key = `${analytic.parentSys}:${id}`;
      if (!descriptions.has(key)) descriptions.set(key, analytic);
    }
  }
  return records.flatMap(({ record, items = [] }) => (byRecord.get(record.sys) || [])
    .filter(asset => !secondaryFaces.has(asset.face))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map(asset => {
      const companions = asset.pairId ? groups.get(`${asset.sys}:${asset.pairId}`) : [asset];
      const images = [asset, ...companions.filter(image => image.id !== asset.id)
        .sort((a, b) => (a.groupOrder ?? a.sortOrder) - (b.groupOrder ?? b.sortOrder))];
      const analytic = images.map(image => descriptions.get(`${record.sys}:${image.id}`)).find(Boolean);
      return { asset, images, record, items, analytic, hasDescriptions: describedRecords.has(record.sys),
        title: analytic?.title || record.cardTitle || record.title || 'Sin título' };
    }));
}

export function filterGalleryEntries(entries, filters = {}) {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es');
  const includes = (values, term) => !normalize(term) || normalize(values.filter(Boolean).join(' ')).includes(normalize(term));
  const from = Number(filters.from) || null, to = Number(filters.to) || from;
  return entries.filter(({ record, analytic, items, asset, hasDescriptions }) => {
    const subjects = [...(record.access || []), ...(analytic?.subjects || [])];
    const genres = [...(record.genres || []), ...(analytic?.genres || [])];
    const dates = [record.date, record.title, analytic?.date].filter(Boolean).join(' ');
    const years = [...dates.matchAll(/(?:17|18|19|20)\d{2}/g)].map(match => Number(match[0]));
    // A MARC contents list describes the whole set. Searching it on every tile
    // would make a hit in one published analytic retrieve all its siblings.
    const extraFields = [...(record.notes || []), ...(record.allFields || [])]
      .filter(value => !hasDescriptions || !/\s--\s/.test(value));
    return includes([record.author, record.responsibility, analytic?.author], filters.author)
      && includes(subjects, filters.subject) && includes(genres, filters.genre)
      && (!from && !to || years.some(year => (!from || year >= from) && (!to || year <= to)))
      && includes([record.sys, record.title, record.author, record.responsibility, record.date, record.physical,
        ...extraFields, ...(record.locations || []),
        ...subjects, ...genres, analytic?.title, analytic?.author, analytic?.date, analytic?.notes,
        ...items.flatMap(item => [item.barcode, item.location]), asset.originalName], filters.query);
  });
}

export function relatedTerms(entry) {
  const { record, analytic } = entry;
  return {
    subjects: unique([...(analytic?.subjects || []), ...(record.access || [])].map(cleanTerm)),
    genres: unique([...(analytic?.genres || []), ...(record.genres || [])]),
  };
}

export function createGallery(React, ReactDOM) {
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef } = React;

  function Photograph({ image, title, large = false, zoomed = false }) {
    const [original, setOriginal] = useState(null);
    const preview = image.thumbnailUrl || image.url;
    useEffect(() => {
      let active = true;
      setOriginal(null);
      if (large) globalThis.HLP_LOCAL_IMAGE?.(image).then(url => {
        if (active && url) setOriginal(url);
      }).catch(() => {});
      return () => { active = false; };
    }, [image.id, preview, large]);
    return h('img', { src: original || (large ? image.url : preview), alt: title,
      loading: large ? 'eager' : 'lazy', decoding: 'async',
      width: image.width, height: image.height,
      className: zoomed ? 'is-zoomed' : '',
      onError: event => {
        const element = event.currentTarget;
        if (element.src !== new URL(preview, location.href).href) element.src = preview;
        else element.classList.add('image-unavailable');
      } });
  }

  function ImageCard({ entry, index, total, onClose, onNavigate, onRelated, onRecord }) {
    const dialog = useRef(null);
    const [face, setFace] = useState(entry.asset.id), [zoomed, setZoomed] = useState(false);
    const image = entry.images.find(item => item.id === face) || entry.asset;
    const { record, analytic } = entry;
    const author = analytic?.author || record.author;
    const date = analytic?.date || record.date;
    const terms = relatedTerms(entry);
    useEffect(() => { setFace(entry.asset.id); setZoomed(false); }, [entry.asset.id]);
    useEffect(() => {
      const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      dialog.current.showModal();
      return () => {
        document.body.style.overflow = previousOverflow;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      };
    }, []);
    const related = (kind, term) => onRelated(kind, term, record, !!analytic);
    return ReactDOM.createPortal(h('dialog', {
      className: 'hlp-image-card', ref: dialog, 'aria-labelledby': 'hlp-image-title',
      onCancel: event => { event.preventDefault(); onClose(); },
      onClick: event => { if (event.target === event.currentTarget) onClose(); },
      onKeyDown: event => {
        if (event.target.closest('input, select, textarea')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); onNavigate(event.key === 'ArrowLeft' ? -1 : 1);
        }
      },
    }, h('div', { className: 'hlp-image-card-layout' },
      h('button', { type: 'button', className: 'hlp-image-close', onClick: onClose,
        'aria-label': 'Cerrar imagen', autoFocus: true }, '×'),
      h('section', { className: 'hlp-image-presentation', 'aria-label': 'Imagen y vistas vinculadas' },
        h('div', { className: `hlp-image-stage ${zoomed ? 'is-zoomed' : ''}`, tabIndex: 0,
          'aria-label': 'Imagen. Usá las flechas del teclado para recorrer los resultados.' },
          h(Photograph, { key: image.id, image, title: entry.title, large: true, zoomed })),
        h('div', { className: 'hlp-image-controls' },
          h('button', { type: 'button', disabled: index === 0, onClick: () => onNavigate(-1),
            'aria-label': 'Imagen anterior' }, 'Anterior'),
          h('span', { 'aria-live': 'polite' }, `${index + 1} / ${total}`),
          h('button', { type: 'button', 'aria-pressed': zoomed, onClick: () => setZoomed(value => !value) },
            zoomed ? 'Ajustar' : 'Ampliar'),
          h('button', { type: 'button', disabled: index === total - 1, onClick: () => onNavigate(1),
            'aria-label': 'Imagen siguiente' }, 'Siguiente')),
        entry.images.length > 1 && h('div', { className: 'hlp-image-faces', 'aria-label': 'Vistas de la pieza' },
          entry.images.map((item, position) => h('button', { key: item.id, type: 'button',
            'aria-pressed': item.id === image.id,
            onClick: () => { setFace(item.id); setZoomed(false); } },
          h(Photograph, { image: item, title: '' }),
          h('span', null, faceNames[item.face] || `Imagen ${position + 1}`))))),
      h('aside', { className: 'hlp-image-information' },
        h('h2', { id: 'hlp-image-title' }, entry.title),
        author && h('button', { type: 'button', className: 'hlp-image-author',
          onClick: () => related('author', author) }, author),
        date && h('p', { className: 'hlp-image-date' }, date),
        record.physical && h('p', { className: 'hlp-image-physical' }, record.physical),
        (terms.subjects.length > 0 || terms.genres.length > 0) && h('section', { className: 'hlp-image-related' },
          h('h3', null, 'Seguir explorando'),
          h('div', null,
            terms.subjects.map(term => h('button', { key: `subject:${term}`, type: 'button',
              onClick: () => related('subject', term) }, term)),
            terms.genres.map(term => h('button', { key: `genre:${term}`, type: 'button',
              className: 'genre', onClick: () => related('genre', term) }, term)))),
        analytic && h('p', { className: 'hlp-image-parent' }, 'En ', record.title),
        h('button', { type: 'button', className: 'hlp-image-bibliography', onClick: () => onRecord(record.sys) },
          'Ver ficha bibliográfica')))), document.body);
  }

  return function Gallery({ records, analytics, filters, version, onRelated, onRecord, onClear }) {
    const [assets, setAssets] = useState(null), [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0), [selected, setSelected] = useState(null);
    const [limit, setLimit] = useState(120);
    useEffect(() => {
      let active = true;
      setError('');
      fetch('/api/digitals?all=1').then(response => {
        if (!response.ok) throw new Error('No se pudieron cargar las imágenes.');
        return response.json();
      }).then(result => { if (active) setAssets(result.assets); })
        .catch(failure => { if (active) setError(failure.message); });
      return () => { active = false; };
    }, [version, attempt]);
    const entries = useMemo(() => filterGalleryEntries(galleryEntries(records, assets || [], analytics), filters),
      [records, assets, analytics, filters.query, filters.author, filters.subject, filters.genre, filters.from, filters.to]);
    useEffect(() => { setLimit(120); }, [records]);
    const index = entries.findIndex(entry => entry.asset.id === selected), entry = entries[index];
    const recordCount = new Set(entries.map(item => item.record.sys)).size;
    const navigate = delta => { if (entries[index + delta]) setSelected(entries[index + delta].asset.id); };
    if (error) return h('div', { className: 'aleph-empty', role: 'alert' }, h('p', null, error),
      h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, 'Reintentar'));
    if (!assets) return h('p', { role: 'status' }, 'Cargando imágenes…');
    if (!entries.length) return h('div', { className: 'aleph-empty' }, h('strong', null, 'Sin imágenes para mostrar'),
      h('p', null, 'Probá ampliar la búsqueda o quitar filtros. Los registros sin imágenes se pueden consultar en el catálogo bibliográfico.'),
      h('button', { type: 'button', onClick: onClear }, 'Limpiar filtros'));
    return h(React.Fragment, null,
      h('p', { className: 'hlp-gallery-count', role: 'status' },
        `${entries.length} ${entries.length === 1 ? 'imagen' : 'imágenes'} · ${recordCount} ${recordCount === 1 ? 'registro' : 'registros'}`),
      h('div', { className: 'hlp-gallery-grid', 'aria-label': 'Galería de imágenes' },
        entries.slice(0, limit).map(item => h('button', { key: item.asset.id, type: 'button',
          className: 'hlp-gallery-tile', 'aria-label': item.title, onClick: () => setSelected(item.asset.id) },
        h(Photograph, { image: item.asset, title: '' }), h('span', { className: 'hlp-gallery-title' }, item.title)))),
      entries.length > limit && h('button', { type: 'button', className: 'hlp-gallery-more',
        onClick: () => setLimit(value => value + 120) }, `Mostrar más imágenes (${limit} de ${entries.length})`),
      entry && h(ImageCard, { entry, index, total: entries.length, onClose: () => setSelected(null),
        onNavigate: navigate, onRecord, onRelated: (...args) => { setSelected(null); onRelated(...args); } }));
  };
}
