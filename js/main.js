import { Scanner } from './scanner.js';
import { startParticles } from './particles.js';
import { encodeAppUrl, decodeAppParams, isStandalone } from './appstate.js';
import { faviconCandidates, firstLoadableFavicon } from './favicon.js';
import { searchIcons, iconSvgUrl } from './iconify.js';
import { renderIconToCanvas, renderPlaceholderIcon, buildIconDataUri } from './iconBuilder.js';
import { buildManifestDataUri, applyManifestLink, applyIOSMeta } from './manifestBuilder.js';

const $ = (id) => document.getElementById(id);
const views = ['scan', 'preview', 'customize', 'install'].reduce((m, k) => {
  m[k] = $(`view-${k}`);
  return m;
}, {});

function showView(name) {
  for (const key in views) views[key].hidden = key !== name;
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

function hueToHex(hue, sat = 70, light = 45) {
  const c = document.createElement('canvas'); // avoids a hand-rolled HSL->RGB converter
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Entry: figure out which of the three modes this page load is.
// ---------------------------------------------------------------------------
const params = decodeAppParams(new URLSearchParams(location.search));

if (params && isStandalone()) {
  runLaunch(params);
} else if (params) {
  runInstallView(params);
} else {
  runScanFlow();
}

// ---------------------------------------------------------------------------
// Mode: launched from an installed home screen icon -> redirect immediately.
// ---------------------------------------------------------------------------
function runLaunch(cfg) {
  if (cfg.transition === 'instant') {
    location.replace(cfg.targetUrl);
    return;
  }
  document.body.innerHTML = `<div class="launch-fade"><img id="launch-icon" alt=""></div>`;
  const img = $('launch-icon');
  buildIconDataUri(iconOptsFor(cfg)).then((uri) => { img.src = uri; });
  setTimeout(() => location.replace(cfg.targetUrl), cfg.transition === 'slide' ? 480 : 260);
}

// ---------------------------------------------------------------------------
// Mode: this exact URL is a generated app -> show install instructions.
// ---------------------------------------------------------------------------
async function runInstallView(cfg) {
  // Register this before anything else, and touch the manifest/meta tags
  // synchronously (no awaits) below: Chrome can fire `beforeinstallprompt`
  // as soon as it likes, and it must never see the stale default
  // manifest.json (start_url with no params) instead of this app's own.
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('install-android').hidden = false;
    $('install-android-fallback').hidden = true;
  });

  showView('install');
  $('install-app-name').textContent = cfg.name;
  $('install-app-target').textContent = cfg.targetUrl;

  const canvas = $('install-icon-canvas');
  applyForInstall(cfg, renderPlaceholderIcon(canvas, { bgColor: cfg.bgColor, label: cfg.name }));

  // Upgrade to the real icon (favicon/iconify/upload) once it's ready, and
  // re-apply — browsers pick up manifest link / meta tag changes, but the
  // start_url above is already correct even if this never finishes in time.
  await renderIconToCanvas(canvas, iconOptsFor(cfg));
  applyForInstall(cfg, canvas.toDataURL('image/png'));

  const plat = platform();
  if (plat === 'ios') {
    $('install-ios').hidden = false;
  } else if (plat === 'android') {
    // Show the native-prompt button optimistically; if beforeinstallprompt
    // never fires within a short window (criteria not met, or already
    // installed), fall back to manual Chrome-menu instructions.
    $('install-android').hidden = false;
    setTimeout(() => {
      if (!deferredPrompt) {
        $('install-android').hidden = true;
        $('install-android-fallback').hidden = false;
      }
    }, 1200);
  } else {
    $('install-generic').hidden = false;
  }

  $('btn-install-android').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  $('btn-install-restart').addEventListener('click', () => {
    location.href = location.pathname;
  });
}

function applyForInstall(cfg, iconDataUri) {
  const manifestUri = buildManifestDataUri({
    name: cfg.name,
    startUrl: location.href,
    bgColor: cfg.bgColor,
    iconDataUri,
  });
  applyManifestLink(manifestUri);
  applyIOSMeta({ name: cfg.name, bgColor: cfg.bgColor, iconDataUri });
}

function iconOptsFor(cfg) {
  return {
    sourceType: cfg.iconSource,
    sourceValue: cfg.iconSource === 'upload' ? cfg.iconUpload : cfg.iconValue,
    bgColor: cfg.bgColor,
    fgColor: cfg.fgColor,
    label: cfg.name,
  };
}

// ---------------------------------------------------------------------------
// Mode: fresh open -> scan -> preview -> customize -> generate install URL.
// ---------------------------------------------------------------------------
function runScanFlow() {
  showView('scan');
  const stopParticles = startParticles($('particles'));

  const state = {
    targetUrl: '',
    name: '',
    bgHue: 215,
    bgLight: 45,
    bgColor: hueToHex(215, 65, 45),
    fgHue: 0,
    fgLight: 55,
    fgColor: hueToHex(0, 65, 55),
    iconSource: 'favicon',
    iconValue: '',
    iconUpload: '',
    transition: 'fade',
  };

  const scanner = new Scanner($('camera'), {
    onDetect: (value) => {
      scanner.stop();
      stopParticles();
      enterPreview(value);
    },
    onError: () => {
      $('scan-status').textContent = 'Camera unavailable.';
      $('btn-camera-retry').hidden = false;
    },
  });
  scanner.start();

  $('btn-camera-retry').addEventListener('click', () => {
    $('btn-camera-retry').hidden = true;
    $('scan-status').textContent = 'Looking for a code…';
    scanner.start();
  });

  function enterPreview(url) {
    state.targetUrl = url;
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      state.name = host;
      $('preview-host').textContent = host;
    } catch {
      state.name = 'App';
      $('preview-host').textContent = 'App';
    }
    $('preview-open-link').href = url;
    $('preview-url').textContent = url;

    // Detect the favicon once here so both the preview card and the
    // customize step's "Auto" icon reuse the same result.
    loadFaviconCandidates();

    // The live iframe is opt-in (see btn-preview-toggle below): many sites
    // block being framed entirely, and a blank box by default looks broken.
    $('preview-frame-wrap').hidden = true;
    $('preview-frame').removeAttribute('src');
    $('btn-preview-toggle').textContent = 'Show live preview';
    previewFrameLoaded = false;

    showView('preview');
  }

  let previewFrameLoaded = false;
  $('btn-preview-toggle').addEventListener('click', () => {
    const wrap = $('preview-frame-wrap');
    wrap.hidden = !wrap.hidden;
    if (!wrap.hidden && !previewFrameLoaded) {
      $('preview-frame').src = state.targetUrl;
      previewFrameLoaded = true;
    }
    $('btn-preview-toggle').textContent = wrap.hidden ? 'Show live preview' : 'Hide live preview';
  });

  $('btn-preview-back').addEventListener('click', () => {
    showView('scan');
    startParticles($('particles'));
    scanner.start();
  });

  $('btn-preview-next').addEventListener('click', () => enterCustomize());

  // -------------------- Customize --------------------
  let iconify = { selectedId: '', searchTimer: null };
  let mockupRaf = null;

  function enterCustomize() {
    $('input-name').value = state.name;
    updateColorFieldVisibility();
    updateSwatches();
    scheduleMockupUpdate();
    showView('customize');
  }

  $('btn-customize-back').addEventListener('click', () => showView('preview'));

  $('input-name').addEventListener('input', (e) => {
    state.name = e.target.value || 'App';
    scheduleMockupUpdate();
  });

  // Background color only makes sense for the composited sources (Iconify /
  // upload) — "Auto" uses the site's own icon untouched. Icon color only
  // applies to Iconify glyphs, which is the only source we can recolor.
  function updateColorFieldVisibility() {
    $('field-bg-color').hidden = state.iconSource === 'favicon';
    $('field-fg-color').hidden = state.iconSource !== 'iconify';
  }

  // icon source tabs
  document.querySelectorAll('#icon-source-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#icon-source-tabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.iconSource = tab.dataset.source;
      ['favicon', 'iconify', 'upload'].forEach((s) => { $(`panel-${s}`).hidden = s !== state.iconSource; });
      updateColorFieldVisibility();
      scheduleMockupUpdate();
    });
  });

  // Detected once per scan (see enterPreview) and reused as the "Auto" icon;
  // there's no manual re-pick control since the preview card already shows
  // exactly what was found.
  async function loadFaviconCandidates() {
    const best = await firstLoadableFavicon(faviconCandidates(state.targetUrl));
    if (best) {
      state.iconValue = best;
      $('preview-favicon').src = best;
      scheduleMockupUpdate();
    }
  }

  // iconify search
  $('iconify-search').addEventListener('input', (e) => {
    clearTimeout(iconify.searchTimer);
    const q = e.target.value.trim();
    if (!q) { $('iconify-results').innerHTML = ''; return; }
    iconify.searchTimer = setTimeout(() => runIconifySearch(q), 350);
  });
  async function runIconifySearch(q) {
    $('iconify-status').textContent = 'Searching…';
    try {
      const icons = await searchIcons(q);
      $('iconify-status').textContent = icons.length ? '' : 'No icons found.';
      $('iconify-results').innerHTML = '';
      for (const id of icons.slice(0, 30)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = `<img src="${iconSvgUrl(id, '%23ffffff')}" alt="${id}">`;
        btn.addEventListener('click', () => {
          document.querySelectorAll('.iconify-grid button').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          state.iconValue = id;
          scheduleMockupUpdate();
        });
        $('iconify-results').appendChild(btn);
      }
    } catch {
      $('iconify-status').textContent = "Couldn't reach the icon library — check your connection.";
    }
  }

  // upload
  $('upload-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.iconUpload = reader.result;
      scheduleMockupUpdate();
    };
    reader.readAsDataURL(file);
  });

  // colors — hue + lightness sliders together cover the full range
  // (including white and black at the lightness extremes, unreachable from
  // hue alone at a fixed saturation).
  function recomputeBg() {
    state.bgColor = hueToHex(state.bgHue, 65, state.bgLight);
    updateSwatches();
    scheduleMockupUpdate();
  }
  function recomputeFg() {
    state.fgColor = hueToHex(state.fgHue, 65, state.fgLight);
    updateSwatches();
    scheduleMockupUpdate();
  }
  $('slider-bg-hue').addEventListener('input', (e) => { state.bgHue = Number(e.target.value); recomputeBg(); });
  $('slider-bg-light').addEventListener('input', (e) => { state.bgLight = Number(e.target.value); recomputeBg(); });
  $('slider-fg-hue').addEventListener('input', (e) => { state.fgHue = Number(e.target.value); recomputeFg(); });
  $('slider-fg-light').addEventListener('input', (e) => { state.fgLight = Number(e.target.value); recomputeFg(); });

  function updateSwatches() {
    $('swatch-bg').style.background = state.bgColor;
    $('swatch-fg').style.background = state.fgColor;
  }

  $('select-transition').addEventListener('change', (e) => {
    state.transition = e.target.value;
  });

  // Coalesce to at most one redraw per frame — the underlying glyph is
  // cached (see iconBuilder.js), so this reads as real-time even while
  // actively dragging a slider.
  function scheduleMockupUpdate() {
    if (mockupRaf) return;
    mockupRaf = requestAnimationFrame(() => {
      mockupRaf = null;
      updateMockups();
    });
  }
  async function updateMockups() {
    const opts = iconOptsFor(state);
    await Promise.all([
      renderIconToCanvas($('mockup-ios-canvas'), opts),
      renderIconToCanvas($('mockup-android-canvas'), opts),
    ]);
  }

  $('btn-customize-next').addEventListener('click', () => {
    const finalUrl = encodeAppUrl('index.html', state);
    location.href = finalUrl;
  });
}
