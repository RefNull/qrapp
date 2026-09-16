// Encodes/decodes the state of a generated app entirely in the URL query string,
// so the same static page can reconstruct an installable app with no backend.
//
//   t  target URL
//   n  app name
//   bg background color (hex, no #)
//   fg foreground/icon color (hex, no #)
//   is icon source: "favicon" | "monogram" | "iconify" | "upload"
//   iv icon value: favicon candidate index | iconify id | (upload embeds bytes in "iu")
//   iu uploaded icon as a data URI (only present for uploads)
//   fx transition style: "instant" | "fade" | "slide"

export function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  // Reject dangerous pseudo-protocols
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return '';
  }
  let target = trimmed;
  // If no scheme present, default to https://
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(target)) {
    target = 'https://' + target;
  }
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function encodeAppUrl(base, cfg) {
  const params = new URLSearchParams();
  params.set('t', cfg.targetUrl);
  params.set('n', cfg.name);
  params.set('bg', cfg.bgColor.replace('#', ''));
  params.set('fg', cfg.fgColor.replace('#', ''));
  params.set('is', cfg.iconSource);
  if (cfg.iconValue) params.set('iv', cfg.iconValue);
  if (cfg.iconUpload) params.set('iu', cfg.iconUpload);
  params.set('fx', cfg.transition || 'fade');

  // Attach search parameters reliably to current pathname
  const url = new URL(location.pathname, location.origin);
  url.search = params.toString();
  return url.toString();
}

export function decodeAppParams(searchParams) {
  if (!searchParams.has('t')) return null;
  const rawTarget = searchParams.get('t');
  const targetUrl = normalizeUrl(rawTarget);
  if (!targetUrl) return null;

  return {
    targetUrl,
    name: searchParams.get('n') || 'App',
    bgColor: '#' + (searchParams.get('bg') || '3b82f6'),
    fgColor: '#' + (searchParams.get('fg') || 'ffffff'),
    iconSource: searchParams.get('is') || 'favicon',
    iconValue: searchParams.get('iv') || '',
    iconUpload: searchParams.get('iu') || '',
    transition: searchParams.get('fx') || 'fade',
  };
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}
