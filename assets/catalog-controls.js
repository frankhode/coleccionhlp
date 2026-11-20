// Shared search controls for the bibliographic catalog and the visual gallery.
export function installMenuDismissal(document) {
  const menus = () => [...document.querySelectorAll('details.nav-menu[open], details.user-menu[open]')];
  const outside = event => {
    for (const menu of menus()) if (!menu.contains(event.target)) menu.open = false;
  };
  const escape = event => {
    if (event.key !== 'Escape') return;
    for (const menu of menus()) {
      const focused = menu.contains(document.activeElement);
      menu.open = false;
      if (focused) menu.querySelector('summary')?.focus();
    }
  };
  const action = event => {
    const menu = event.target.closest('details.nav-menu, details.user-menu');
    if (menu && event.target.closest('button, a')) menu.open = false;
  };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  document.addEventListener('keydown', escape);
  document.addEventListener('click', action);
  return () => {
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('focusin', outside);
    document.removeEventListener('keydown', escape);
    document.removeEventListener('click', action);
  };
}

export function createCatalogControls(React) {
  const h = React.createElement;
  const { useState, useEffect, useRef } = React;
  return function CatalogControls({ query, onQuery, active, onClear, sort, direction, onSort, onDirection,
    groups, termSort, onTermSort, from, to, onFrom, onTo, gallery, imageMode, onImageMode,
    includeAnalytics, onIncludeAnalytics, view, gallerySize, onGallerySize }) {
    const [open, setOpen] = useState(null), [expanded, setExpanded] = useState(null);
    const controls = useRef(null);
    useEffect(() => { setOpen(null); setExpanded(null); }, [view]);
    useEffect(() => {
      if (!open) return;
      const menu = controls.current?.querySelector(`[data-menu="${open}"]`);
      const dismiss = event => { if (menu && !menu.contains(event.target)) setOpen(null); };
      const escape = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        setOpen(null); menu?.querySelector('button')?.focus();
      };
      document.addEventListener('pointerdown', dismiss);
      document.addEventListener('focusin', dismiss);
      document.addEventListener('keydown', escape);
      return () => {
        document.removeEventListener('pointerdown', dismiss);
        document.removeEventListener('focusin', dismiss);
        document.removeEventListener('keydown', escape);
      };
    }, [open]);
    const select = (label, value, onChange, options) => h('label', { key: label, className: 'hlp-control-field' },
      h('span', null, label), h('select', { value, onChange: event => onChange(event.target.value) },
        options.map(([key, title]) => h('option', { key, value: key }, title))));
    const popover = (id, title, children, indicator) => h('div', {
      className: 'hlp-control-menu', 'data-menu': id,
    }, h('button', { type: 'button', className: 'hlp-control-toggle', 'aria-expanded': open === id,
      'aria-controls': `hlp-${id}-panel`, onClick: () => setOpen(value => value === id ? null : id) },
    title, indicator && h('span', { className: 'hlp-control-indicator' }, indicator)),
    open === id && h('div', { id: `hlp-${id}-panel`, className: `hlp-control-panel hlp-${id}-panel`,
      role: 'region', 'aria-label': title }, children));
    return h('div', { className: 'hlp-catalog-controls', ref: controls },
      h('div', { className: 'hlp-compact-search', role: 'search' },
        h('input', { type: 'search', 'aria-label': gallery ? 'Buscar imágenes' : 'Buscar en todos los campos',
          value: query, placeholder: 'Buscar…', onChange: event => onQuery(event.target.value) }),
        active && h('button', { type: 'button', className: 'hlp-clear-search', onClick: onClear,
          'aria-label': 'Limpiar búsqueda y filtros', title: 'Limpiar búsqueda y filtros' }, '×')),
      gallery && h('label', { className: 'hlp-gallery-size' }, h('span', null, 'Tamaño'),
        h('select', { value: gallerySize, 'aria-label': 'Tamaño de las imágenes',
          onChange: event => onGallerySize(event.target.value) },
        [['small', 'Pequeñas'], ['medium', 'Medianas'], ['large', 'Grandes'], ['xlarge', 'Muy grandes']]
          .map(([value, label]) => h('option', { key: value, value }, label)))),
      popover('sort', 'Ordenar', [
        select('Campo', sort, onSort, [['title', 'Título'], ['author', 'Autor'], ['date', 'Fecha']]),
        select('Sentido', direction, onDirection, [['asc', 'Ascendente'], ['desc', 'Descendente']]),
      ]),
      popover('filters', 'Filtros', h(React.Fragment, null,
        h('div', { className: 'hlp-filter-panel-heading' }, h('strong', null, 'Filtrar resultados'),
          active && h('button', { type: 'button', onClick: onClear }, 'Limpiar filtros')),
        !gallery && h('div', { className: 'hlp-filter-options' },
          h('label', null, h('input', { type: 'checkbox', checked: includeAnalytics,
            onChange: event => onIncludeAnalytics(event.target.checked) }), ' Incluir analíticas'),
          select('Imágenes', imageMode, onImageMode, [['all', 'Todos los registros'], ['with', 'Con imágenes'], ['without', 'Sin imágenes']])) ,
        select('Ordenar términos', termSort, onTermSort, [['count', 'Más frecuentes'], ['alpha', 'Alfabéticamente (A–Z)']]),
        groups.map(group => {
          if (!group.values.length && !group.current) return null;
          const isExpanded = expanded === group.id || !!group.current;
          return h('section', { className: 'hlp-filter-group', key: group.id },
            h('button', { type: 'button', className: 'hlp-filter-heading', 'aria-expanded': isExpanded,
              onClick: () => setExpanded(value => value === group.id ? null : group.id) },
            h('span', null, group.title), h('small', null, group.values.length)),
            isExpanded && h('div', { className: 'hlp-filter-values' }, group.current
              ? h('button', { type: 'button', className: 'is-selected', onClick: () => group.select('') }, group.current,
                h('span', { 'aria-hidden': true }, '×'))
              : group.values.map(([term, count]) => h('button', { type: 'button', key: term, onClick: () => group.select(term) },
                h('span', null, term), h('small', null, count)))));
        }),
        h('fieldset', { className: 'hlp-filter-dates' }, h('legend', null, 'Fecha'),
          ...[['Desde', from, onFrom], ['Hasta', to, onTo]].map(([label, value, change]) => h('label', { key: label },
            h('span', null, label), h('input', { inputMode: 'numeric', maxLength: 4, value,
              placeholder: label === 'Desde' ? '1890' : '1910', onChange: event => change(event.target.value.replace(/\D/g, '').slice(0, 4)) }))),
          h('small', null, 'Para un año exacto, completá solo «Desde».'))), active ? 'Activos' : null));
  };
}
