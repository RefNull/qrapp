// Android/Chrome installability comes from a Web App Manifest. Chrome supports
// data: URIs for the manifest itself (and for the icons inside it), which is
// exactly what lets this be a zero-backend PWA generator: the manifest is
// just a deterministic function of the current page's own URL, computed in
// JS and never stored anywhere.
export function buildManifestDataUri({ name, startUrl, bgColor, fgColor, iconDataUri }) {
  const scopeUrl = new URL(startUrl);
  const manifest = {
    id: startUrl,
    name,
    short_name: name.slice(0, 12),
    start_url: startUrl,
    scope: scopeUrl.origin + scopeUrl.pathname,
    display: 'standalone',
    background_color: bgColor,
    theme_color: fgColor,
    icons: [
      { src: iconDataUri, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: iconDataUri, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest));
}

export function applyManifestLink(dataUri) {
  let link = document.getElementById('link-manifest');
  if (!link) {
    link = document.createElement('link');
    link.id = 'link-manifest';
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = dataUri;
}

// iOS ignores the manifest entirely. Safari reads these tags from whatever
// page is on screen at the moment "Add to Home Screen" is tapped.
export function applyIOSMeta({ name, bgColor, iconDataUri }) {
  document.title = name;
  setMeta('apple-mobile-web-app-title', name);
  setMeta('theme-color', bgColor, 'meta-theme-color');
  const touchIcon = document.getElementById('link-apple-touch-icon');
  if (touchIcon && iconDataUri) touchIcon.href = iconDataUri;
}

function setMeta(name, content, existingId) {
  let el = existingId ? document.getElementById(existingId) : document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}
