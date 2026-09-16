// Encodes/decodes the state of a generated app entirely in the URL query string,
// so the same static page can reconstruct an installable app with no backend.
//
//   t  target URL
//   n  app name
//   bg background color (hex, no #)
//   fg foreground/icon color (hex, no #)
//   is icon source: "favicon" | "iconify" | "upload"
//   iv icon value: favicon candidate index | iconify id | (upload embeds bytes in "iu")
//   iu uploaded icon as a data URI (only present for uploads)
//   fx transition style: "instant" | "fade" | "slide"

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
  const url = new URL(base, location.href);
  url.search = params.toString();
  return url.toString();
}

export function decodeAppParams(searchParams) {
  if (!searchParams.has('t')) return null;
  return {
    targetUrl: searchParams.get('t'),
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
