import test from 'node:test';
import assert from 'node:assert/strict';
import { installMenuDismissal } from '../assets/catalog-controls.js';

test('native navigation menus close outside, on focus changes and on Escape', () => {
  const listeners = new Map(), inside = {}, outside = {};
  let restoredFocus = false;
  const summary = { focus() { restoredFocus = true; } };
  const menu = { open: true, contains: node => node === inside, querySelector: () => summary };
  const document = { activeElement: inside,
    querySelectorAll: () => menu.open ? [menu] : [],
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: type => listeners.delete(type) };
  const cleanup = installMenuDismissal(document);
  listeners.get('pointerdown')({ target: inside });
  assert.equal(menu.open, true);
  listeners.get('pointerdown')({ target: outside });
  assert.equal(menu.open, false);
  menu.open = true;
  listeners.get('focusin')({ target: outside });
  assert.equal(menu.open, false);
  menu.open = true;
  listeners.get('keydown')({ key: 'Escape' });
  assert.equal(menu.open, false);
  assert.equal(restoredFocus, true);
  cleanup();
  assert.equal(listeners.size, 0);
});
