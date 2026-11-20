import test from 'node:test';
import assert from 'node:assert/strict';
import { createGallery } from '../assets/gallery.js';

test('mobile swipes navigate intentionally and ignore vertical scrolling, pinch and zoomed panning', () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.document = { body: {} };
  try {
    let states = [];
    const React = {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState: initial => [states.length ? states.shift() : typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect() {}, useRef: () => ({ current: null }), useMemo: callback => callback(),
    };
    const asset = { id: 'a', sys: '001', sortOrder: 0 }, record = { sys: '001', title: 'Imagen', access: [], genres: [] };
    const Gallery = createGallery(React, { createPortal: tree => tree });
    const find = (node, predicate) => {
      if (!node || typeof node !== 'object') return;
      if (predicate(node)) return node;
      for (const child of node.props?.children || []) {
        const found = Array.isArray(child) ? child.map(item => find(item, predicate)).find(Boolean) : find(child, predicate);
        if (found) return found;
      }
    };
    states = [[asset], '', 0, 'a', 120];
    const tree = Gallery({ records: [{ record }], analytics: [], filters: {} });
    const card = find(tree, node => node.type?.name === 'ImageCard');
    const steps = [];
    const renderStage = zoomed => {
      states = ['a', zoomed, true, false];
      return find(card.type({ ...card.props, onNavigate: step => steps.push(step) }),
        node => node.props?.className?.startsWith('hlp-image-stage')).props;
    };
    const gesture = (stage, x, y, endX, endY, pinch = false) => {
      stage.onTouchStart({ touches: [{ clientX: x, clientY: y }] });
      if (pinch) stage.onTouchMove({ touches: [{}, {}] });
      stage.onTouchEnd({ touches: [], changedTouches: [{ clientX: endX, clientY: endY }] });
    };
    const stage = renderStage(false);
    gesture(stage, 300, 200, 50, 210);
    gesture(stage, 50, 200, 300, 210);
    assert.deepEqual(steps, [1, -1]);
    gesture(stage, 300, 200, 280, 400);
    gesture(stage, 300, 200, 50, 200, true);
    gesture(renderStage(true), 300, 200, 50, 200);
    assert.deepEqual(steps, [1, -1]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
