/**
 * The player's settings and the HUD's types without the game itself: the pages around the game can
 * read and change them without loading three.js and the renderer (the game loads when it starts).
 */
export type { AudioSettings } from './audio.ts'
export type { GameHandle, GameOptions } from './game.ts'
export type { HudState } from './hud-store.ts'
export { loadDamageNumbers, saveDamageNumbers, setTips, tipsOn } from './preferences.ts'
export { type GraphicsSetting, loadGraphicsSetting, saveGraphicsSetting } from './render/quality.ts'
