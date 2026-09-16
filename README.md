# QR to App

Turn any QR code into a customized home-screen app on iOS and Android. No App Store, no accounts, and zero backend.

[![Live Demo](https://img.shields.io/badge/demo-live-success.svg)](https://refnull.github.io/qrapp/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Backend](https://img.shields.io/badge/backend-none-brightgreen.svg)
![Type](https://img.shields.io/badge/type-PWA-blue.svg)

---

## How It Works

1. **Scan**: Point your phone camera at any QR code in the fullscreen viewfinder.
2. **Style**: Name your app, pick brand colors, and choose an icon (auto-detected site favicon, letter monogram, searchable vector icon, or custom upload).
3. **Install & Share**: Add directly to your home screen in Safari (iOS) or Chrome (Android), or share a one-click install link.

The installed app launches in full standalone mode right from your home screen, with an optional splash transition into the target site.

---

## Zero-Backend Architecture

The entire project is static HTML, CSS, and vanilla JavaScript served over HTTPS. App configuration lives entirely in the URL query string—no database, no analytics, and no tracking.

The exact same page adapts its behavior based on how it is opened:

| Context | Mode | What happens |
| :--- | :--- | :--- |
| **Browser tab (no params)** | **Scanner** | Fullscreen camera viewfinder (`BarcodeDetector` with automatic `jsQR` fallback), hardware torch toggle, real-time particle effects, and swipe-up install sheet. |
| **Browser tab (with params)** | **Installer** | Injects an in-memory `data:` URI Web App Manifest for Android Chrome, or updates dynamic `apple-touch-icon` tags for iOS Safari, with one-tap native Web Share. |
| **Home screen (standalone)** | **Launcher** | Detects standalone display mode and redirects straight to the destination page with a branded transition. |

See [`js/appstate.js`](js/appstate.js) for the exact parameter schema.

---

## Icon Sourcing

| Source | Recolorable | Details |
| :--- | :--- | :--- |
| **Auto** | No | Pulls high-resolution favicons from public discovery endpoints with touch-icon fallbacks. |
| **Letter** | Yes | Typography monogram tile with customizable letter and background colors. |
| **Icon** | Yes | Search and recolor thousands of vector glyphs via the keyless [Iconify](https://iconify.design) API. |
| **Upload** | No | Upload any photo or logo; automatically downscaled to 192&times;192 client-side to keep the shareable URL compact. |

If an image fails to load or draw, the generator falls back to a clean monogram tile so installation is never blocked.

---

## Deployment

No build steps, no bundlers, no dependencies to install.

Drop the files onto any static host:
- **GitHub Pages**: Settings &rarr; Pages &rarr; Source: `Deploy from a branch` &rarr; `main` branch, folder `/(root)`.
- **Cloudflare Pages / Netlify / Vercel**: Set root directory to `./`, build command empty, output directory `./`.

---

## Technical Constraints

- **iOS Cookie Isolation**: iOS Safari runs standalone home-screen apps in an isolated WebKit container separate from the main Safari browser session. Sites requiring authentication may prompt for login on first launch.
- **Canvas Tainting**: Cross-origin site favicons loaded without permissive CORS headers cannot be color-shifted via pixel manipulation. Full color customization is supported on Iconify glyphs and uploaded images.
- **Storage Limits**: Because all state is encoded into the URL, uploaded images are downscaled to 192&times;192 PNG to stay safely below mobile browser URL length limits.

---

## License

MIT &mdash; see [LICENSE](LICENSE).
