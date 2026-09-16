# QR to App

A zero-backend Progressive Web App that scans a QR code and turns the page it
points to into a home-screen icon with a custom name, icon, and colors —
without needing a native app, an app store, or a server.

## How it works

Everything is static files at the repo root — no backend, no database. State
for each generated app (target URL, name, icon, colors, launch transition) is
encoded entirely in the page's own URL query string, so the exact same static
page can act as three different things depending on how it's opened:

1. **Fresh open, no params** — the scanner: camera-based QR detection (native
   `BarcodeDetector` where available, falling back to vendored `jsQR` for
   Safari/iOS), a preview of the scanned page, and an icon/color customizer.
2. **Opened with params, in a regular browser tab** — the install view. On
   Android/Chrome it injects a `data:` URI Web App Manifest (icons and all)
   so Chrome's native install prompt picks it up; on iOS it sets the
   `apple-touch-icon`/theme meta tags on the page itself, since Safari reads
   those directly from whatever's on screen when you tap Share → Add to Home
   Screen (there's no API for a third-party app or page to trigger that step
   automatically on iOS).
3. **Opened with params, already installed (standalone display mode)** —
   redirects straight into the target site, with an optional brief branded
   transition first.

See `js/appstate.js` for the exact URL param schema.

## Deploying

Any static host works (GitHub Pages, Cloudflare Pages, Netlify, etc.) —
just serve this repo's contents over HTTPS. No build step, no server code.

For GitHub Pages: Settings → Pages → Source: "Deploy from a branch" →
Branch: `main`, folder `/ (root)`.

## Known open item — needs a real-device check

Chrome's support for `data:` URI manifests (including inline base64 icons)
is a documented, reliable pattern and is what Android install relies on here.
The one piece that hasn't been verified on real hardware is whether iOS
Safari reliably captures a dynamically-set `apple-touch-icon` (pointing at a
generated `data:` PNG) at the moment "Add to Home Screen" is tapped, across
current iOS versions. If it turns out to be unreliable on some versions, the
fallback is to prefer the target site's own favicon URL directly (already the
default "Auto" icon source) rather than a composited/recolored one for iOS.

## Icon sourcing

- **Auto** (default): pulls the scanned site's favicon via Google's public
  favicon lookup service, with `/apple-touch-icon.png` and `/favicon.ico` as
  fallbacks. Not recolorable (arbitrary cross-origin images can't be safely
  read back off a canvas), but composited onto your chosen background color.
- **Icon library**: search via the free, keyless [Iconify](https://iconify.design)
  API — these fully support the icon color slider.
- **Upload**: use your own image, composited onto the background color.

If none of these can be loaded or drawn, the icon falls back to a simple
monogram tile (first letter of the app name) so app creation never gets
stuck on a bad image.
