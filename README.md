# QR to App

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Backend](https://img.shields.io/badge/backend-none-brightgreen.svg)
![Type](https://img.shields.io/badge/type-PWA-blue.svg)

Scans a QR code and turns the page it points to into a home-screen app — custom name, icon, and colors — without a native app, an app store, or a server.

## How it works

The entire thing is static files served over HTTPS. State for each generated app (target URL, name, icon, colors, launch transition) lives in the page's own URL rather than a database, so the exact same page behaves differently depending on how it's opened:

| Opened as... | Behavior |
| :--- | :--- |
| Fresh, no params | **Scanner** — camera QR detection (native `BarcodeDetector`, falling back to vendored `jsQR` on Safari/iOS), a preview of the scanned page, and an icon/color customizer. |
| With params, in a browser tab | **Install view** — injects a `data:` URI manifest for Chrome's install prompt on Android, or sets `apple-touch-icon`/theme meta tags for Safari's native Add to Home Screen on iOS. |
| With params, already installed (standalone) | **Launch** — redirects straight into the target site, with an optional brief branded transition. |

See [`js/appstate.js`](js/appstate.js) for the exact URL param schema.

## Icon sourcing

| Source | Recolorable | Notes |
| :--- | :--- | :--- |
| **Auto** (default) | No | Pulls the scanned site's favicon via Google's public favicon lookup, with `/apple-touch-icon.png` and `/favicon.ico` as fallbacks. |
| **Icon library** | Yes | Search via the free, keyless [Iconify](https://iconify.design) API. |
| **Upload** | No | Composited onto your chosen background color as-is. |

If nothing loads or draws, the icon falls back to a monogram tile so app creation never gets stuck on a bad image.

## Deploying

Any static host works — GitHub Pages, Cloudflare Pages, Netlify. No build step, no server code.

For GitHub Pages: Settings → Pages → Source → `main`, folder `/(root)`. Everything lives at the repo root rather than a subfolder since "deploy from branch" only serves `/(root)` or `/docs`.

## Known limitations

- **iOS touch-icon reliability is unverified on real hardware.** Chrome's `data:` URI manifest support is a documented pattern; whether Safari reliably captures a dynamically-set `apple-touch-icon` at Add-to-Home-Screen time across current iOS versions still needs a device check. Fallback: prefer the target site's own favicon URL directly.
- **Installed standalone apps on iOS get their own cookie jar**, separate from Safari — a site that requires login may prompt again on first launch.
- **Arbitrary favicons can't be recolored.** Reading pixels back off a cross-origin `<img>` without permissive CORS headers taints the canvas, so only Iconify glyphs and uploads support the icon color slider.

## License

MIT — see [LICENSE](LICENSE).
