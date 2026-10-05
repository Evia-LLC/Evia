/**
 * The character prototype's public surface. Import it lazily, and only with
 * the prototype switched on (switch.svelte.ts): everything reachable from here
 * pulls in three.js and the mannequin.
 *
 *   const { createCharacter } = await import('@/character3d/index.ts');
 *
 * See README.md.
 */
export { createCharacter, mountStandalone, STAGE, MANNEQUIN_URL, type CharacterInputs, type CharacterPass } from './character.ts';
