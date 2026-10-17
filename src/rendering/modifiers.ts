import { Platform } from 'react-native';

/** Keyboard modifier state (web only; always false on touch platforms). */
export const modifiers = { shift: false, ctrl: false, alt: false, space: false };

let installed = false;

export function installModifierTracking(): () => void {
  if (installed || Platform.OS !== 'web' || typeof window === 'undefined') return () => {};
  installed = true;
  const update = (e: KeyboardEvent, down: boolean) => {
    if (e.key === 'Shift') modifiers.shift = down;
    if (e.key === 'Control' || e.key === 'Meta') modifiers.ctrl = down;
    if (e.key === 'Alt') modifiers.alt = down;
    if (e.code === 'Space') modifiers.space = down;
  };
  const kd = (e: KeyboardEvent) => update(e, true);
  const ku = (e: KeyboardEvent) => update(e, false);
  const blur = () => {
    modifiers.shift = modifiers.ctrl = modifiers.alt = modifiers.space = false;
  };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    window.removeEventListener('blur', blur);
    installed = false;
  };
}
