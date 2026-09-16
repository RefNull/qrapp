// Android/Chrome installability comes from a Web App Manifest. Chrome supports
// data: URIs for the manifest itself (and for the icons inside it), which is
// exactly what lets this be a zero-backend PWA generator: the manifest is
// just a deterministic function of the current page's own URL, computed in
// JS and never stored anywhere.
export function buildManifestDataUri({ name, startUrl, bgColor, iconDataUri }) {
  const scopeUrl = new URL(startUrl);
  // iconDataUri is normally a PNG data URI we generated, but for a favicon that
  // could not be drawn to an exportable canvas it is the remote image URL. We
  // don't know that image's real dimensions or type, so declare neither.
  const isGenerated = iconDataUri.startsWith('data:');
  const icon = isGenerated
    ? { sizes: '512x512', type: 'image/png' }
    : { sizes: 'any' };
  const manifest = {
    id: startUrl,
    name,
    short_name: name.slice(0, 12),
    start_url: startUrl,
    scope: scopeUrl.origin + scopeUrl.pathname,
    display: 'standalone',
    background_color: bgColor,
    theme_color: bgColor, // matches the iOS theme-color meta tag below
    icons: [
      { src: iconDataUri, ...icon, purpose: 'any' },
      { src: iconDataUri, ...icon, purpose: 'maskable' },
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
  setMeta('apple-mobile-web-app-title', name, 'meta-apple-title');
  setMeta('theme-color', bgColor, 'meta-theme-color');
  setMeta('apple-mobile-web-app-capable', 'yes', 'meta-apple-capable');
  setMeta('mobile-web-app-capable', 'yes');

  if (iconDataUri) {
    const oldIcon = document.getElementById('link-apple-touch-icon');
    const newIcon = document.createElement('link');
    newIcon.id = 'link-apple-touch-icon';
    newIcon.rel = 'apple-touch-icon';
    newIcon.sizes = '180x180';
    newIcon.href = iconDataUri;
    if (oldIcon && oldIcon.parentNode) {
      oldIcon.parentNode.replaceChild(newIcon, oldIcon);
    } else {
      document.head.appendChild(newIcon);
    }
  }
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
