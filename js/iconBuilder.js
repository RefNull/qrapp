import { fetchIconSvgText } from './iconify.js';

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
// they're never cross-origin-tainted). A favicon pulled from an arbitrary
// site is loaded as a plain <img>; if that site doesn't send permissive CORS
// headers, reading the canvas back throws a SecurityError, caught below with
// a monogram fallback so icon creation never gets stuck on a bad image.
//
// Loaded glyphs are cached by their source key so dragging a color slider —
// which never changes the glyph itself, only how it's composited — redraws
// from the cached image instead of re-fetching over the network each time.
const glyphCache = new Map(); // key -> Promise<HTMLImageElement>

function glyphCacheKey({ sourceType, sourceValue, fgColor }) {
  return sourceType === 'iconify' ? `iconify:${sourceValue}:${fgColor}` : `${sourceType}:${sourceValue}`;
}

function loadGlyphImage(opts) {
  const { sourceType, sourceValue, fgColor } = opts;
  if (!sourceValue) return Promise.reject(new Error('No icon source available'));

  const key = glyphCacheKey(opts);
  if (glyphCache.has(key)) return glyphCache.get(key);

  const promise = (async () => {
    if (sourceType === 'iconify') {
      const svgText = await fetchIconSvgText(sourceValue, fgColor);
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        return await loadImage(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (sourceType === 'upload') {
      return loadImage(sourceValue); // data URI, always same-origin-safe
    }
    if (sourceType === 'favicon') {
      return loadImage(sourceValue, true); // may taint the canvas, handled by caller
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

function drawMonogram(ctx, size, label, bgColor) {
  const letter = (label || '?').trim().charAt(0).toUpperCase() || '?';
  const n = parseInt(bgColor.replace('#', ''), 16) || 0;
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  ctx.fillStyle = lum > 0.6 ? '#111318' : '#ffffff';
  ctx.font = `700 ${Math.round(size * 0.46)}px -apple-system, Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2 + size * 0.03);
}

// Synchronous placeholder (background + monogram, no image loads at all).
// Used so the manifest/meta tags can carry a valid icon on the very first
// script tick, before any async glyph fetch — see runInstallView in main.js.
export function renderPlaceholderIcon(canvas, { bgColor, label }) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  drawFill(ctx, size, bgColor);
  drawMonogram(ctx, size, label, bgColor);
  return canvas.toDataURL('image/png');
}

// Draws the icon into an existing canvas (used for both the live mockup
// previews and the final install icon). Returns true if the real glyph was
// drawn, false if it fell back to a monogram.
export async function renderIconToCanvas(canvas, opts) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const isAuto = opts.sourceType === 'favicon';

  drawFill(ctx, size, isAuto ? '#ffffff' : opts.bgColor);
  try {
    const img = await loadGlyphImage(opts);
    drawContained(ctx, size, img, isAuto ? 0.94 : 0.66);
    if (isAuto) {
      // Force a pixel read now so a tainted canvas fails here, inside the
      // try block, rather than later when the caller calls toDataURL().
      ctx.getImageData(0, 0, 1, 1);
    }
    return true;
  } catch {
    drawFill(ctx, size, opts.bgColor);
    drawMonogram(ctx, size, opts.label, opts.bgColor);
    return false;
  }
}

export async function buildIconDataUri(opts, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  await renderIconToCanvas(canvas, opts);
  return canvas.toDataURL('image/png');
}
