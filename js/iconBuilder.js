import { fetchIconSvgText } from './iconify.js?v=11';

// Builds the final home-screen icon entirely client-side.
//
// "Auto" (favicon) icons are the site's own, already-designed image — drawn
// near edge-to-edge on a plain white backdrop, not recolored or inset into a
// safe zone, since that's not ours to restyle. Iconify glyphs and uploads
// *are* raw glyphs that need a backdrop, so those get the user's background
// color and are inset into a ~66% "safe zone" (standard maskable-icon
// guidance) so OS icon masks don't clip them.
//
// Recoloring only works reliably for Iconify glyphs (fetched as text, so
// they're never cross-origin-tainted). Favicons are a different story: in
// practice essentially no favicon host sends Access-Control-Allow-Origin —
// not even the public lookup services — so a CORS-enabled <img> load of one
// almost always fails outright. When it does, the image is re-loaded without
// CORS: the canvas is then tainted and can no longer be exported, but it can
// still be *displayed*, and the caller is told so it can hand the OS the
// original image URL instead of a data URI. Only when even that fails does
// icon creation fall back to a monogram.
//
// Loaded glyphs are cached by their source key so dragging a color slider —
// which never changes the glyph itself, only how it's composited — redraws
// from the cached image instead of re-fetching over the network each time.
const glyphCache = new Map(); // key -> Promise<HTMLImageElement>

function glyphCacheKey({ sourceType, sourceValue }, allowTaint) {
  return `${sourceType}:${allowTaint ? 'taint' : 'cors'}:${sourceValue}`;
}

function loadGlyphImage(opts, { allowTaint = false } = {}) {
  const { sourceType, sourceValue } = opts;
  if (!sourceValue) return Promise.reject(new Error('No icon source available'));

  const key = glyphCacheKey(opts, allowTaint);
  if (glyphCache.has(key)) return glyphCache.get(key);

  const promise = (async () => {
    if (sourceType === 'iconify') {
      const svgText = await fetchIconSvgText(sourceValue, '#000000');
      const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
      return loadImage(dataUri);
    }
    if (sourceType === 'upload') {
      return loadImage(sourceValue); // data URI, always same-origin-safe
    }
    if (sourceType === 'favicon') {
      // crossOrigin unless the caller has accepted a tainted canvas.
      return loadImage(sourceValue, !allowTaint);
    }
    throw new Error(`Unknown icon source type: ${sourceType}`);
  })();

  glyphCache.set(key, promise);
  promise.catch(() => glyphCache.delete(key)); // don't cache failures
  return promise;
}

function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawFill(ctx, size, color) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

function drawContained(ctx, size, img, coverage) {
  const box = size * coverage;
  const offset = (size - box) / 2;
  const ratio = img.width && img.height ? img.width / img.height : 1;
  let dw = box, dh = box;
  if (ratio > 1) dh = box / ratio;
  else if (ratio < 1) dw = box * ratio;
  ctx.drawImage(img, offset + (box - dw) / 2, offset + (box - dh) / 2, dw, dh);
}

function drawMonogram(ctx, size, label, bgColor, fgColor) {
  const letter = (label || '?').trim().charAt(0).toUpperCase() || '?';
  if (fgColor) {
    ctx.fillStyle = fgColor;
  } else {
    const n = parseInt(bgColor.replace('#', ''), 16) || 0;
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    ctx.fillStyle = lum > 0.6 ? '#111318' : '#ffffff';
  }
  ctx.font = `700 ${Math.round(size * 0.46)}px -apple-system, Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2 + size * 0.03);
}

// Synchronous placeholder (background + monogram, no image loads at all).
// Used so the manifest/meta tags can carry a valid icon on the very first
// script tick, before any async glyph fetch — see runInstallView in main.js.
export function renderPlaceholderIcon(canvas, { bgColor, fgColor, label }) {
  const size = canvas.width;
  drawFill(canvas.getContext('2d'), size, bgColor);
  drawMonogram(canvas.getContext('2d'), size, label, bgColor, fgColor);

  // Exported from a throwaway canvas rather than `canvas`: a previous render
  // may have tainted the visible one, which would make toDataURL throw here.
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportCanvas.height = size;
  const exportCtx = exportCanvas.getContext('2d');
  drawFill(exportCtx, size, bgColor);
  drawMonogram(exportCtx, size, label, bgColor, fgColor);
  return exportCanvas.toDataURL('image/png');
}

// Draws the icon into an existing canvas (used for both the live mockup
// previews and the final install icon). Returns `{ tainted }` — when true the
// canvas holds a real cross-origin image that cannot be exported, so callers
// needing a URI must use the original source URL instead of toDataURL().
export async function renderIconToCanvas(canvas, opts) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Synchronous first-class monogram handling: zero flashing, zero async latency
  if (opts.sourceType === 'monogram') {
    drawFill(ctx, size, opts.bgColor);
    drawMonogram(ctx, size, opts.label, opts.bgColor, opts.fgColor);
    return { tainted: false };
  }

  const isAuto = opts.sourceType === 'favicon';
  const isIconify = opts.sourceType === 'iconify';
  // Use offscreen canvas to prevent clearing visible canvas while awaiting
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = size;
  const offCtx = offscreen.getContext('2d');
  offCtx.imageSmoothingEnabled = true;
  offCtx.imageSmoothingQuality = 'high';

  let tainted = false;
  try {
    let img;
    try {
      img = await loadGlyphImage(opts);
    } catch (err) {
      // Retry favicons without CORS. The result is display-only.
      if (!isAuto) throw err;
      img = await loadGlyphImage(opts, { allowTaint: true });
      tainted = true;
    }

    drawFill(offCtx, size, isAuto ? '#ffffff' : opts.bgColor);

    if (isIconify && opts.fgColor) {
      // Recolor cached black glyph client-side via canvas compositing
      const glyphCanvas = document.createElement('canvas');
      glyphCanvas.width = glyphCanvas.height = size;
      const gCtx = glyphCanvas.getContext('2d');
      gCtx.imageSmoothingEnabled = true;
      gCtx.imageSmoothingQuality = 'high';

      drawContained(gCtx, size, img, 0.66);
      gCtx.globalCompositeOperation = 'source-in';
      gCtx.fillStyle = opts.fgColor;
      gCtx.fillRect(0, 0, size, size);

      offCtx.drawImage(glyphCanvas, 0, 0);
    } else {
      drawContained(offCtx, size, img, isAuto ? 0.94 : 0.66);
    }

    if (isAuto && !tainted) {
      // Force a pixel read now so an unexpectedly tainted canvas fails here,
      // inside the try block, rather than later on toDataURL().
      offCtx.getImageData(0, 0, 1, 1);
    }
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(offscreen, 0, 0);
    return { tainted };
  } catch {
    // Fresh canvas so a taint picked up above is not carried into the fallback.
    const clean = document.createElement('canvas');
    clean.width = clean.height = size;
    const cleanCtx = clean.getContext('2d');
    drawFill(cleanCtx, size, opts.bgColor);
    drawMonogram(cleanCtx, size, opts.label, opts.bgColor, opts.fgColor);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(clean, 0, 0);
    return { tainted: false };
  }
}

export async function buildIconDataUri(opts, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const { tainted } = await renderIconToCanvas(canvas, opts);
  // A tainted canvas cannot be exported; the original URL is itself a usable
  // image source, which is all the caller needs.
  if (tainted) return opts.sourceValue;
  return canvas.toDataURL('image/png');
}
