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

// Resolves the first candidate that actually loads as an image.
export function firstLoadableFavicon(candidates) {
  return new Promise((resolve) => {
    let i = 0;
    function tryNext() {
      if (i >= candidates.length) return resolve(null);
      const url = candidates[i++];
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = tryNext;
      img.src = url;
    }
    tryNext();
  });
}
