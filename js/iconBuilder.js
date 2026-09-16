import { fetchIconSvgText } from './iconify.js';

// Builds the final home-screen icon entirely client-side: a full-bleed
// background fill (so it looks right whether or not the OS applies its own
// adaptive-icon mask) plus the glyph centered in the ~70% "safe zone".
//
// Recoloring only works reliably for Iconify glyphs (fetched as text, so
// they're never cross-origin-tainted) and for the user's own upload. A
// favicon pulled from an arbitrary site is loaded as a plain <img>; if that
// site doesn't send permissive CORS headers, reading the canvas back throws
// a SecurityError. We catch that and fall back to a plain monogram tile
// rather than fail the whole flow.

async function loadGlyphImage({ sourceType, sourceValue, fgColor }) {
  if (sourceType === 'iconify' && sourceValue) {
    const svgText = await fetchIconSvgText(sourceValue, fgColor);
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      return await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (sourceType === 'upload' && sourceValue) {
    return loadImage(sourceValue); // data URI, always same-origin-safe
  }
  if (sourceType === 'favicon' && sourceValue) {
    return loadImage(sourceValue, true); // may taint the canvas, handled by caller
  }
  throw new Error('No icon source available');
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

function drawBackground(ctx, size, bgColor) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);
}

function drawGlyph(ctx, size, img) {
  const safe = size * 0.66;
  const offset = (size - safe) / 2;
  const ratio = img.width && img.height ? img.width / img.height : 1;
  let dw = safe, dh = safe;
  if (ratio > 1) dh = safe / ratio;
  else if (ratio < 1) dw = safe * ratio;
  ctx.drawImage(img, offset + (safe - dw) / 2, offset + (safe - dh) / 2, dw, dh);
}

function drawMonogram(ctx, size, label, bgColor) {
  const letter = (label || '?').trim().charAt(0).toUpperCase() || '?';
  // pick readable text color against the chosen background
  const rgb = hexToRgb(bgColor);
  const luminance = rgb ? (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 : 0.5;
  ctx.fillStyle = luminance > 0.6 ? '#111318' : '#ffffff';
  ctx.font = `700 ${Math.round(size * 0.46)}px -apple-system, Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2 + size * 0.03);
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

// Draws the icon into an existing canvas (used for live mockup previews).
// Returns true if the real glyph was drawn, false if it fell back to a monogram.
export async function renderIconToCanvas(canvas, opts) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, size, opts.bgColor);
  try {
    const img = await loadGlyphImage(opts);
    drawGlyph(ctx, size, img);
    if (opts.sourceType === 'favicon') {
      // Force a pixel read now so a tainted canvas fails here, inside the
      // try block, rather than later when the caller calls toDataURL().
      ctx.getImageData(0, 0, 1, 1);
    }
    return true;
  } catch {
    drawBackground(ctx, size, opts.bgColor);
    drawMonogram(ctx, size, opts.label, opts.bgColor);
    return false;
  }
}

export async function buildIconDataUri(opts, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  await renderIconToCanvas(canvas, opts);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    // Tainted despite our earlier check (rare race) — rebuild as a monogram.
    const ctx = canvas.getContext('2d');
    drawBackground(ctx, size, opts.bgColor);
    drawMonogram(ctx, size, opts.label, opts.bgColor);
    return canvas.toDataURL('image/png');
  }
}
