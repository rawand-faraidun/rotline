# Rotline brand pack

Put this folder in the repository at `/brand`. Every logo file has its lettering converted to shapes, so it looks the same everywhere and does not need any font installed.

**Name:** Rotline
**Slogan:** Hold the line against the rot.

## Files

### `svg/` (use these in the website and game UI)

| File | Use |
|---|---|
| `rotline-logo-horizontal.svg` | Main logo on dark backgrounds |
| `rotline-logo-horizontal-slogan.svg` | Main logo with slogan, dark backgrounds (landing page hero, loading screen) |
| `rotline-logo-stacked.svg`, `rotline-logo-stacked-slogan.svg` | Square or tall spaces: title screen, splash |
| `*-onecolor-dark.svg` | One colour, for light backgrounds |
| `*-onecolor-light.svg` | One colour, for dark or busy photo backgrounds |
| `rotline-mark.svg` | The symbol alone, two colours, dark backgrounds |
| `rotline-mark-onecolor-*.svg` | The symbol alone in one colour |
| `rotline-icon-dark.svg`, `rotline-icon-lime.svg` | App icon tiles with rounded corners |
| `rotline-icon-square.svg`, `rotline-icon-maskable.svg` | Full-bleed square icons for Apple touch and PWA maskable use |
| `favicon.svg` | Browser tab icon, uses a simplified mark that stays sharp at 16 px |
| `rotline-social-card.svg` | 1200 × 630 link preview image |

### `png/` (ready-made exports)

`favicon.ico` (16, 32, 48), `favicon-16/32/48.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `rotline-social-card.png`, and large logo PNGs for documents and store pages.

### Tokens

`tokens.json` and `tokens.css` hold the colours and font names below.

## Colours

| Token | Hex | Use |
|---|---|---|
| rot-black | `#0D100E` | Main background |
| surface | `#1B211C` | Panels, cards, icon tile |
| bone | `#ECE8DC` | Main text, the line in the mark, "LINE" in the wordmark |
| rot-lime | `#B8F23C` | Brand accent: the mark, "ROT" in the wordmark, primary buttons |
| muted | `#A9AD9E` | Secondary text, the slogan |
| alert | `#FF5630` | Interface only: danger, damage, downed state |
| warning | `#FFC02E` | Interface only: warnings, timers |

Alert and warning are interface colours. They are never used in the logo.

## Fonts

Both are free under the SIL Open Font License.

- **Saira Stencil One**: the wordmark, large titles, mission names. Use it in capitals.
- **Chakra Petch** (weights 500 and 700): interface, HUD and body text.

Load them self-hosted (for example the `@fontsource/saira-stencil-one` and `@fontsource/chakra-petch` npm packages) rather than from a third-party CDN, so the game does not depend on another server at load time.

## Rules

- Leave clear space around the logo at least as wide as the mark's horizontal line is tall, times three.
- Minimum sizes: the full logo at 120 px wide, the mark at 24 px. Below 48 px use `favicon.svg`.
- Use the two-colour versions only on dark backgrounds. On light backgrounds use `onecolor-dark`.
- Do not stretch, rotate, outline, add shadows or glows to, or recolour the logo beyond the files provided.
- "ROT" is always lime and "LINE" always bone in the two-colour wordmark.

## HTML head snippet

```html
<link rel="icon" href="/brand/svg/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/png/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/brand/png/apple-touch-icon.png">
<meta name="theme-color" content="#0D100E">
<meta property="og:title" content="Rotline">
<meta property="og:description" content="Hold the line against the rot.">
<meta property="og:image" content="/brand/png/rotline-social-card.png">
```

Web app manifest icons: `icon-192.png` and `icon-512.png` with `"purpose": "any"`, and `icon-maskable-512.png` with `"purpose": "maskable"`.
