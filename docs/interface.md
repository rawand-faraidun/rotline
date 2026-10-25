# Interface

Dark, military, hazard-themed, with hard edges. The interface must feel like equipment, not like a web app.

## Building blocks

- Components start from **shadcn/ui**: its components are copied into `packages/ui` and owned by the project, built on accessible primitives (focus management, keyboard support, screen-reader roles come for free).
- **None of shadcn's default look survives.** Every component is restyled to the rules below, so nothing reads as "a shadcn site": no rounded corners, no soft shadows, no neutral grey palette, no default spacing rhythm.
- Styling uses Tailwind CSS with the brand tokens from `/brand/tokens.css` mapped to theme variables.

## Shape

- **No curves.** The radius token is `0` everywhere. No pills, no circles except where the content is round (avatar frames are square or octagonal).
- **Rough, cut edges.** Panels, buttons, inputs and cards use chamfered corners (one or two corners cut at 45°, 6–10 px) via `clip-path`, with 1–2 px borders that follow the cut.
- **Worn surfaces.** Panels carry a faint noise/grain texture and occasional scuffed edges; large headers can use a stencil break. Kept subtle so text stays crisp.
- **Hazard accents.** Diagonal warning stripes (warning yellow on rot-black) mark dangerous actions and alerts; corner brackets frame selected items.
- **Hard shadows only.** Either none, or a solid offset block (2–4 px) in rot-black; never blurred drop shadows.
- **Dividers** are straight 1 px lines or dashed "tape" lines; no rounded separators.

## Colour

| Token | Hex | Use in the interface |
|---|---|---|
| rot-black | `#0D100E` | Page and HUD background |
| surface | `#1B211C` | Panels, cards, inputs |
| bone | `#ECE8DC` | Main text, borders on focus |
| rot-lime | `#B8F23C` | Primary buttons, selection, focus outlines, progress |
| muted | `#A9AD9E` | Secondary text, disabled labels |
| alert | `#FF5630` | Danger, damage, downed state, destructive actions |
| warning | `#FFC02E` | Warnings, timers, hazard stripes |

Alert and warning are interface colours only, never used in the logo. Information is never carried by red versus green alone: states also use icons, patterns or text.

## Type

- **Saira Stencil One**, in capitals, for titles, mission names, the multiplier and big numbers (queue position, countdowns).
- **Chakra Petch 500 and 700** for everything else: interface, HUD, body text.
- Both are self-hosted. Numbers in the HUD use tabular figures so they do not jitter.

## Motion

- Fast and mechanical: 80–150 ms, linear or stepped easing, slides and wipes rather than fades and bounces.
- Every animation respects the reduced-motion setting and the operating system preference.

## Components (restyled)

Buttons (primary lime, secondary outlined bone, destructive alert with stripes), inputs and selects, tabs, dialogs, sheets, dropdown menus, tooltips, toasts, sliders (settings), switches, progress bars (segmented), tables (ledger, leaderboards), cards (weapons, gear, missions), avatar frames, badges (class, level, mutation), and the context menu for inventory items.

## Screens

Landing, queue, lobby hub, class and skill tree, armory (inventory, upgrades, discard), shop, contracts, friends, mission select with the campaign map, firing range, bestiary, achievements and cosmetics, results, profile and statistics, leaderboards, settings, privacy and terms, admin.

## The queue page

A full-screen, on-brand waiting room: the logo with the slogan; slow animated fog and silhouettes of the horde along the bottom edge (paused when the tab is hidden); the position in large stencil numerals with an estimated wait range and a segmented progress bar; friends online and what they are doing; rotating tips and bestiary entries; a clear "Leave queue" action; a sound and optional browser notification when admitted, followed by a 90-second countdown and a large "Enter" button. It works at 200 % zoom, with the keyboard and screen readers (position changes are announced politely).

## HUD

Health and armour, ammunition (magazine and reserve; the pistol shows ∞), ability cooldowns, the score multiplier and chain timer (top centre, large), objective tracker, an interact prompt (what pressing or holding E would do, with a progress bar for holds), teammate status with downed timers, active buff timers, mutation alerts, an objective arrow, an arrow at the screen's edge toward each teammate out of view (in their slot colour, with name and distance, red while downed), a minimap in the top-right corner (walls, doors still shut, every zombie, the squad, the objective) that opens over the game to show the whole map with a click or M, and the ping wheel. The mouse wheel zooms the camera a little in or out (kept per browser). HUD panels use the same cut-corner frames at low opacity so the battlefield stays visible.

## Settings

Graphics quality presets (low, medium, high; automatic picks high for a graphics card, medium for graphics built into the processor, low for a software renderer, and a frame-rate guard lowers the resolution, and drops ambient occlusion first, when frames run under 50 a second), key rebinding, gamepad support, audio sliders, interface scale, screen-shake toggle, gore toggle, reduced flashing for effects like the nuke, and colour-vision-safe palettes. All interface text lives in translation files.
