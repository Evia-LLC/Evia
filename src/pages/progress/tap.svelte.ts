/**
 * Button size for the Progress cards' small buttons.
 *
 * The small (36px) buttons are the right size to the eye on a desktop, but on
 * a touch screen their stretched hit area currently stops at 42px, short of
 * the 44px minimum (BUILD-PLAN decision 7). Until the shared buttons grow it,
 * this page simply uses the 44px size wherever the pointer is coarse.
 */
import { MediaQuery } from 'svelte/reactivity';

const coarse = new MediaQuery('pointer: coarse', false);

/** 'md' (44px) on touch screens, 'sm' elsewhere. */
export function tapSize(): 'sm' | 'md' {
  return coarse.current ? 'md' : 'sm';
}
