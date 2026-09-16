// Favicon discovery without a backend. We can't fetch+parse an arbitrary
// cross-origin page's <head> for <link rel="icon"> due to CORS, so we rely on
// well-known conventions plus a public favicon lookup service as the most
// reliable first guess.
export function faviconCandidates(targetUrl) {
  let origin, hostname;
  try {
    const u = new URL(targetUrl);
    origin = u.origin;
    hostname = u.hostname;
  } catch {
    return [];
  }
  return [
    `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(hostname)}`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/favicon.ico`,
  ];
}

// Resolves the first candidate that loads as an image.
export function firstLoadableFavicon(candidates) {
  return Promise.any(candidates.map((url) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(url);
    img.onerror = rej;
    img.src = url;
  }))).catch(() => null);
}
