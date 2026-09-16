// Thin client for the free, keyless Iconify API (https://iconify.design) —
// used as the "icon library" layer. SVGs are fetched as text (not loaded as
// cross-origin <img>), so once we have them they're safe to redraw/recolor on
// a canvas without tainting it.
const API = 'https://api.iconify.design';

export async function searchIcons(query, limit = 30) {
  const res = await fetch(`${API}/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  if (!res.ok) throw new Error(`Iconify search failed: ${res.status}`);
  const data = await res.json();
  return data.icons || [];
}

export function iconSvgUrl(iconId, color) {
  const [prefix, name] = iconId.split(':');
  const params = color ? `?color=${encodeURIComponent(color)}` : '';
  return `${API}/${prefix}/${name}.svg${params}`;
}

export async function fetchIconSvgText(iconId, color) {
  const res = await fetch(iconSvgUrl(iconId, color));
  if (!res.ok) throw new Error(`Iconify icon fetch failed: ${res.status}`);
  return res.text();
}
