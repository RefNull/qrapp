import { Scanner } from './scanner.js?v=11';
import { startParticles } from './particles.js?v=11';
import { encodeAppUrl, decodeAppParams, isStandalone, normalizeUrl } from './appstate.js?v=11';
import { faviconCandidates, firstLoadableFavicon } from './favicon.js?v=11';
import { searchIcons, iconSvgUrl } from './iconify.js?v=11';
import { renderIconToCanvas, renderPlaceholderIcon, buildIconDataUri } from './iconBuilder.js?v=11';
import { buildManifestDataUri, applyManifestLink, applyIOSMeta } from './manifestBuilder.js?v=11';

const $ = (id) => document.getElementById(id);
const views = ['scan', 'preview', 'customize', 'install'].reduce((m, k) => {
  m[k] = $(`view-${k}`);
  return m;
}, {});

function showView(name) {
  for (const key in views) {
    const el = views[key];
    if (!el) continue;
    const isTarget = key === name;
    el.hidden = !isTarget;
    el.style.display = isTarget ? '' : 'none';
  }
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

const colorCanvas = document.createElement('canvas');
colorCanvas.width = colorCanvas.height = 1;
const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });

function colorToHex(hue, sat, light) {
  colorCtx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
  colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorCtx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function calcColor(hue, light) {
  // Hue 0 is designated as Monochrome / Neutral (0% saturation) so the shade
  // slider smoothly traverses from pure black to pure white through true greys.
  // Hue > 0 applies standard vivid 65% saturation.
  const sat = hue === 0 ? 0 : 65;
  return colorToHex(hue, sat, light);
}

// ---------------------------------------------------------------------------
// Global PWA install prompt handler
// ---------------------------------------------------------------------------
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const androidBtn = $('install-android');
  const androidFallback = $('install-android-fallback');
  if (androidBtn) androidBtn.hidden = false;
  if (androidFallback) androidFallback.hidden = true;

  const sheetAndroid = $('sheet-android-block');
  const sheetFallback = $('sheet-android-fallback');
  if (sheetAndroid) sheetAndroid.hidden = false;
  if (sheetFallback) sheetFallback.hidden = true;
});

// A beforeinstallprompt event can only be used once, so it is cleared after
// showing regardless of what the user chose. Chrome does not reliably re-fire
// it in the same page session, so if the user dismissed the dialog the primary
// button would silently do nothing from then on — swap in the manual steps.
async function showChromeInstallPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (choice?.outcome !== 'accepted') showAndroidManualFallback();
}

function showAndroidManualFallback() {
  if (platform() !== 'android') return;
  for (const [primaryId, fallbackId] of [
    ['install-android', 'install-android-fallback'],
    ['sheet-android-block', 'sheet-android-fallback'],
  ]) {
    const primary = $(primaryId);
    const fallback = $(fallbackId);
    if (primary) primary.hidden = true;
    if (fallback) fallback.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Entry: figure out which of the three modes this page load is.
// ---------------------------------------------------------------------------
const searchParams = new URLSearchParams(location.search);
const params = decodeAppParams(searchParams);
const isCreatedInThisSession = (() => {
  try {
    return sessionStorage.getItem('qrapp_created') === '1';
  } catch {
    return false;
  }
})();
// Immediate launcher mode: only when opened as an installed home-screen app.
// `launch=1` is carried by the manifest start_url and nothing else, so it is a
// second signal for the cases where an Android WebAPK opens without reporting
// `display-mode: standalone` — without it those users land on the install page
// instead of their app.
const isLaunchMode = Boolean(
  params && (isStandalone() || searchParams.has('launch')) && !isCreatedInThisSession
);

// NOTE: the actual dispatch happens in boot() at the very bottom of this
// module. Calling it here would run runInstallView() while the module-level
// `let` bindings it assigns (activeInstallCfg, installViewInitialized) are
// still in their temporal dead zone, throwing a ReferenceError and leaving a
// blank page for anyone opening a shared install link.

// ---------------------------------------------------------------------------
// Mode: launched from an installed home screen icon -> redirect immediately.
// ---------------------------------------------------------------------------
function runLaunch(cfg) {
  if (cfg.transition === 'instant') {
    location.replace(cfg.targetUrl);
    return;
  }
  const transitionClass = cfg.transition === 'slide' ? 'launch-slide' : 'launch-fade';
  document.body.innerHTML = `<div class="${transitionClass}"><img id="launch-icon" alt=""></div>`;
  const img = $('launch-icon');

  // Synchronous placeholder icon so the launch screen never renders blank
  const placeholderCanvas = document.createElement('canvas');
  placeholderCanvas.width = placeholderCanvas.height = 160;
  img.src = renderPlaceholderIcon(placeholderCanvas, { bgColor: cfg.bgColor, label: cfg.name });

  buildIconDataUri(iconOptsFor(cfg), 160).then((uri) => {
    img.src = uri;
  });
  setTimeout(() => location.replace(cfg.targetUrl), cfg.transition === 'slide' ? 420 : 280);
}

// ---------------------------------------------------------------------------
// Mode: this exact URL is a generated app -> show install instructions.
// ---------------------------------------------------------------------------
let installViewInitialized = false;
let activeInstallCfg = null;

async function runInstallView(cfg) {
  activeInstallCfg = cfg;
  showView('install');
  $('install-app-name').textContent = cfg.name;
  $('install-app-target').textContent = cfg.targetUrl;

  const canvas = $('install-icon-canvas');
  applyForInstall(cfg, renderPlaceholderIcon(canvas, { bgColor: cfg.bgColor, fgColor: cfg.fgColor, label: cfg.name }));

  // Upgrade to the real icon (favicon/iconify/upload) once it's ready, and
  // re-apply — browsers pick up manifest link / meta tag changes, but the
  // start_url above is already correct even if this never finishes in time.
  const opts = iconOptsFor(cfg);
  const { tainted } = await renderIconToCanvas(canvas, opts);
  // A tainted canvas means the favicon could only be loaded without CORS, so
  // it cannot be exported — but the OS can fetch that URL itself.
  applyForInstall(cfg, tainted ? opts.sourceValue : canvas.toDataURL('image/png'));

  const plat = platform();
  if (plat === 'ios') {
    $('install-ios').hidden = false;
  } else if (plat === 'android') {
    if (deferredInstallPrompt) {
      $('install-android').hidden = false;
      $('install-android-fallback').hidden = true;
    } else {
      $('install-android').hidden = false;
      setTimeout(() => {
        if (!deferredInstallPrompt) {
          $('install-android').hidden = true;
          $('install-android-fallback').hidden = false;
        }
      }, 1200);
    }
  } else {
    $('install-generic').hidden = false;
  }

  if (!installViewInitialized) {
    installViewInitialized = true;

    $('btn-install-android').addEventListener('click', () => showChromeInstallPrompt());

    const shareBtn = $('btn-install-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const shareUrl = encodeAppUrl(activeInstallCfg || params || {});
        const copied = await copyToClipboard(shareUrl);
        if (copied) {
          const originalText = shareBtn.textContent;
          shareBtn.textContent = 'Link copied!';
          setTimeout(() => { shareBtn.textContent = originalText; }, 2000);
        } else {
          prompt('Copy this link to share the app:', shareUrl);
        }
      });
    }

    $('btn-install-restart').addEventListener('click', () => {
      try {
        sessionStorage.removeItem('qrapp_created');
      } catch {}
      location.href = location.pathname;
    });
  }
}

async function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '-9999px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (ok) return true;
  } catch {}
  return false;
}

function applyForInstall(cfg, iconDataUri) {
  const launchUrl = encodeAppUrl(cfg, { launch: true });

  const manifestUri = buildManifestDataUri({
    name: cfg.name,
    startUrl: launchUrl,
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

// Returns the scan view to a live state (camera + particles running). Assigned
// by runScanFlow because both live in its closure; the popstate handler below
// needs it, since showView('scan') alone leaves a dead, frozen viewfinder.
let resumeScanView = null;

// ---------------------------------------------------------------------------
// Mode: fresh open -> scan -> preview -> customize -> generate install URL.
// ---------------------------------------------------------------------------
function runScanFlow() {
  showView('scan');
  let stopParticles = startParticles($('particles'));

  const state = {
    targetUrl: '',
    name: '',
    bgHue: 215,
    bgLight: 45,
    bgColor: calcColor(215, 45),
    fgHue: 0,
    fgLight: 100,
    fgColor: '#ffffff',
    iconSource: 'favicon',
    // iconValue is whatever the *current* source needs. The per-source slots
    // below keep each source's pick intact when the user tabs between them —
    // without them, choosing an Iconify glyph and then switching back to Auto
    // would try to load the glyph id ("mdi:home") as a favicon image URL and
    // silently fall back to a monogram.
    iconValue: '',
    faviconValue: '',
    iconifyValue: '',
    iconUpload: '',
    transition: 'fade',
  };

  const torchBtn = $('btn-torch');
  if (torchBtn) {
    torchBtn.addEventListener('click', async () => {
      const active = await scanner.toggleTorch();
      torchBtn.classList.toggle('active', Boolean(active));
    });
  }

  const scanner = new Scanner($('camera'), {
    onDetect: (value) => {
      const cleanUrl = normalizeUrl(value);
      if (!cleanUrl) return;

      const pill = $('scan-pill');
      const pillText = $('scan-title');
      if (pill) pill.classList.add('locked');
      if (pillText) pillText.textContent = 'Code detected';

      if (stopParticles?.converge) {
        stopParticles.converge();
      }

      if ('vibrate' in navigator) {
        try { navigator.vibrate(40); } catch {}
      }

      setTimeout(() => {
        scanner.stop();
        if (stopParticles) stopParticles();
        enterPreview(cleanUrl);
      }, 260);
    },
    onError: () => {
      const errorCard = $('scan-error-card');
      if (errorCard) errorCard.hidden = false;
      $('scan-status').textContent = 'Camera permission required to scan.';
      $('btn-camera-retry').hidden = false;
    },
    onTorchChange: ({ supported, active }) => {
      if (torchBtn) {
        torchBtn.hidden = !supported;
        torchBtn.classList.toggle('active', Boolean(active));
      }
    },
  });
  scanner.start();

  $('btn-camera-retry').addEventListener('click', () => {
    const errorCard = $('scan-error-card');
    if (errorCard) errorCard.hidden = true;
    $('btn-camera-retry').hidden = true;
    const pillText = $('scan-title');
    if (pillText) pillText.textContent = 'Scan QR code';
    scanner.start();
  });

  function enterPreview(url) {
    closeInstallSheet();
    const cleanUrl = normalizeUrl(url);
    state.targetUrl = cleanUrl;
    state.faviconValue = '';
    state.iconValue = iconValueForSource(state.iconSource);
    try {
      const host = new URL(cleanUrl).hostname.replace(/^www\./, '');
      state.name = host;
      $('preview-host').textContent = host;
    } catch {
      state.name = 'App';
      $('preview-host').textContent = 'App';
    }
    $('preview-open-link').href = cleanUrl;
    $('preview-url').textContent = cleanUrl;

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

  resumeScanView = () => {
    closeInstallSheet();
    const pill = $('scan-pill');
    const pillText = $('scan-title');
    if (pill) pill.classList.remove('locked');
    if (pillText) pillText.textContent = 'Scan QR code';

    showView('scan');
    if (stopParticles) stopParticles();
    stopParticles = startParticles($('particles'));
    scanner.start();
  };

  $('btn-preview-back').addEventListener('click', () => resumeScanView());

  // -------------------- Install as App Bottom Sheet --------------------
  const installSheetBackdrop = $('install-sheet-backdrop');
  const showInstallSheetBtn = $('btn-show-install-sheet');
  const closeInstallSheetBtn = $('btn-close-sheet');
  const sheetContainer = $('install-sheet');
  const sheetHandleBar = $('sheet-handle-bar');
  const sheetInstallAndroidBtn = $('btn-sheet-install-android');

  if (isStandalone() && showInstallSheetBtn) {
    showInstallSheetBtn.hidden = true;
  }

  function openInstallSheet() {
    const plat = platform();
    if (plat === 'ios') {
      $('sheet-ios-block').hidden = false;
      $('sheet-android-block').hidden = true;
      $('sheet-android-fallback').hidden = true;
      $('sheet-generic-block').hidden = true;
    } else if (plat === 'android') {
      $('sheet-ios-block').hidden = true;
      $('sheet-generic-block').hidden = true;
      if (deferredInstallPrompt) {
        $('sheet-android-block').hidden = false;
        $('sheet-android-fallback').hidden = true;
      } else {
        $('sheet-android-block').hidden = true;
        $('sheet-android-fallback').hidden = false;
      }
    } else {
      $('sheet-ios-block').hidden = true;
      $('sheet-android-block').hidden = true;
      $('sheet-android-fallback').hidden = true;
      $('sheet-generic-block').hidden = false;
    }

    installSheetBackdrop.hidden = false;
    void installSheetBackdrop.offsetWidth;
    installSheetBackdrop.classList.add('active');
  }

  function closeInstallSheet() {
    if (!installSheetBackdrop || installSheetBackdrop.hidden) return;
    installSheetBackdrop.classList.remove('active');
    if (sheetContainer) sheetContainer.style.transform = '';
    setTimeout(() => {
      installSheetBackdrop.hidden = true;
    }, 280);
  }

  if (showInstallSheetBtn) {
    showInstallSheetBtn.addEventListener('click', openInstallSheet);
  }
  if (closeInstallSheetBtn) {
    closeInstallSheetBtn.addEventListener('click', closeInstallSheet);
  }
  if (installSheetBackdrop) {
    installSheetBackdrop.addEventListener('click', (e) => {
      if (e.target === installSheetBackdrop) closeInstallSheet();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && installSheetBackdrop && !installSheetBackdrop.hidden) {
      closeInstallSheet();
    }
  });

  if (sheetInstallAndroidBtn) {
    sheetInstallAndroidBtn.addEventListener('click', async () => {
      await showChromeInstallPrompt();
      closeInstallSheet();
    });
  }

  // Swipe down on handle bar to dismiss
  if (sheetHandleBar && sheetContainer) {
    let startY = 0;
    let diffY = 0;
    sheetHandleBar.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      diffY = 0;
      sheetContainer.style.transition = 'none';
    }, { passive: true });

    sheetHandleBar.addEventListener('touchmove', (e) => {
      const currentY = e.touches[0].clientY;
      diffY = currentY - startY;
      if (diffY > 0) {
        sheetContainer.style.transform = `translateY(${diffY}px)`;
      }
    }, { passive: true });

    sheetHandleBar.addEventListener('touchend', () => {
      sheetContainer.style.transition = '';
      if (diffY > 75) {
        closeInstallSheet();
      } else {
        sheetContainer.style.transform = '';
      }
    });
  }

  $('btn-preview-next').addEventListener('click', () => enterCustomize());

  // -------------------- Customize --------------------
  let iconify = { searchTimer: null };
  let mockupRaf = null;

  function updateShadeTrack(sliderId, hue) {
    const slider = $(sliderId);
    if (!slider) return;
    const sat = hue === 0 ? 0 : 65;
    const midColor = `hsl(${hue}, ${sat}%, 50%)`;
    slider.style.background = `linear-gradient(90deg, #000000 0%, ${midColor} 50%, #ffffff 100%)`;
  }

  function enterCustomize() {
    $('input-name').value = state.name;
    $('slider-bg-hue').value = state.bgHue;
    $('slider-bg-light').value = state.bgLight;
    $('slider-fg-hue').value = state.fgHue;
    $('slider-fg-light').value = state.fgLight;
    updateShadeTrack('slider-bg-light', state.bgHue);
    updateShadeTrack('slider-fg-light', state.fgHue);
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

  // Background color applies to monogram, Iconify, and uploads (favicon uses
  // the original image as-is). Icon color applies to both Iconify glyphs and
  // the monogram letter.
  function updateColorFieldVisibility() {
    $('field-bg-color').hidden = state.iconSource === 'favicon';
    $('field-fg-color').hidden = state.iconSource !== 'iconify' && state.iconSource !== 'monogram';
  }

  // icon source tabs
  document.querySelectorAll('#icon-source-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#icon-source-tabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.iconSource = tab.dataset.source;
      state.iconValue = iconValueForSource(state.iconSource);
      ['favicon', 'monogram', 'iconify', 'upload'].forEach((s) => {
        const p = $(`panel-${s}`);
        if (p) p.hidden = s !== state.iconSource;
      });
      updateColorFieldVisibility();
      scheduleMockupUpdate();
    });
  });

  // Detected once per scan (see enterPreview) and reused as the "Auto" icon;
  // there's no manual re-pick control since the preview card already shows
  // exactly what was found.
  function iconValueForSource(source) {
    if (source === 'favicon') return state.faviconValue;
    if (source === 'iconify') return state.iconifyValue;
    return ''; // monogram needs no value; upload carries its bytes in iconUpload
  }

  async function loadFaviconCandidates() {
    const requestedUrl = state.targetUrl;
    const best = await firstLoadableFavicon(faviconCandidates(requestedUrl));
    // Re-scanning before the probe settles would otherwise let the older
    // lookup overwrite the newer site's icon.
    if (best && state.targetUrl === requestedUrl) {
      state.faviconValue = best;
      if (state.iconSource === 'favicon') state.iconValue = best;
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
        btn.innerHTML = `<img src="${iconSvgUrl(id, '#000000')}" alt="${id}">`;
        btn.addEventListener('click', () => {
          document.querySelectorAll('.iconify-grid button').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          state.iconifyValue = id;
          state.iconValue = id;
          scheduleMockupUpdate();
        });
        $('iconify-results').appendChild(btn);
      }
    } catch {
      $('iconify-status').textContent = "Couldn't reach the icon library — check your connection.";
    }
  }

  // Uploaded bytes ride in the `iu` query parameter of the app's own URL, which
  // is both the shareable install link and the manifest start_url. Request-line
  // limits on static hosts and CDNs start biting around 8KB, so the encoded
  // icon is squeezed under a budget rather than merely resized: a 192x192 PNG
  // of a photograph routinely encodes to 30-80KB, which would produce a link
  // that 414s before any of this code gets to run.
  const UPLOAD_URI_BUDGET = 6000; // characters of data URI

  // Progressively cheaper encodings, best quality first. JPEG variants are
  // composited onto the background colour because JPEG has no alpha channel.
  const UPLOAD_ENCODINGS = [
    { dim: 192, type: 'image/png' },
    { dim: 128, type: 'image/png' },
    { dim: 192, type: 'image/jpeg', quality: 0.82 },
    { dim: 160, type: 'image/jpeg', quality: 0.72 },
    { dim: 128, type: 'image/jpeg', quality: 0.6 },
  ];

  function encodeUpload(img, { dim, type, quality }) {
    let w = img.width;
    let h = img.height;
    if (w > dim || h > dim) {
      if (w > h) {
        h = Math.round((h * dim) / w);
        w = dim;
      } else {
        w = Math.round((w * dim) / h);
        h = dim;
      }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (type === 'image/jpeg') {
      ctx.fillStyle = state.bgColor;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL(type, quality);
  }

  $('upload-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $('upload-status');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let encoded = '';
        let degraded = false;
        for (const encoding of UPLOAD_ENCODINGS) {
          encoded = encodeUpload(img, encoding);
          if (encoded.length <= UPLOAD_URI_BUDGET) break;
          degraded = true;
        }
        state.iconUpload = encoded;
        if (status) {
          status.textContent = encoded.length > UPLOAD_URI_BUDGET
            ? 'This image is very detailed, so the share link will be long and may not open everywhere. A simpler logo works better.'
            : degraded
              ? 'Image compressed to keep the share link short.'
              : '';
        }
        scheduleMockupUpdate();
      };
      img.onerror = () => {
        if (status) status.textContent = "That file couldn't be read as an image.";
      };
      img.src = reader.result;
    };
    reader.onerror = () => {
      if (status) status.textContent = "That file couldn't be read.";
    };
    reader.readAsDataURL(file);
  });

  // colors — hue + lightness sliders together cover the full range
  // (including white and black at the lightness extremes, unreachable from
  // hue alone at a fixed saturation).
  function recomputeBg() {
    state.bgColor = calcColor(state.bgHue, state.bgLight);
    updateSwatches();
    updateShadeTrack('slider-bg-light', state.bgHue);
    scheduleMockupUpdate();
  }
  function recomputeFg() {
    state.fgColor = calcColor(state.fgHue, state.fgLight);
    updateSwatches();
    updateShadeTrack('slider-fg-light', state.fgHue);
    scheduleMockupUpdate();
  }
  $('slider-bg-hue').addEventListener('input', (e) => { state.bgHue = Number(e.target.value); recomputeBg(); });
  $('slider-bg-light').addEventListener('input', (e) => { state.bgLight = Number(e.target.value); recomputeBg(); });
  $('slider-fg-hue').addEventListener('input', (e) => { state.fgHue = Number(e.target.value); recomputeFg(); });
  $('slider-fg-light').addEventListener('input', (e) => { state.fgLight = Number(e.target.value); recomputeFg(); });

  document.querySelectorAll('#chips-bg .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.bgHue = Number(btn.dataset.hue);
      state.bgLight = Number(btn.dataset.light);
      $('slider-bg-hue').value = state.bgHue;
      $('slider-bg-light').value = state.bgLight;
      recomputeBg();
    });
  });

  document.querySelectorAll('#chips-fg .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.fgHue = Number(btn.dataset.hue);
      state.fgLight = Number(btn.dataset.light);
      $('slider-fg-hue').value = state.fgHue;
      $('slider-fg-light').value = state.fgLight;
      recomputeFg();
    });
  });

  function updateSwatches() {
    $('swatch-bg').style.background = state.bgColor;
    $('swatch-fg').style.background = state.fgColor;
  }

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
    const installUrl = encodeAppUrl(state);
    try {
      sessionStorage.setItem('qrapp_created', '1');
    } catch {}
    history.pushState({ view: 'install', cfg: { ...state } }, '', installUrl);
    runInstallView(state);
  });
}

window.addEventListener('popstate', (e) => {
  if (e.state && e.state.view) {
    if (e.state.view === 'install' && e.state.cfg) {
      runInstallView(e.state.cfg);
    } else {
      showView(e.state.view);
    }
  } else if (!decodeAppParams(new URLSearchParams(location.search))) {
    // Not a generated-app URL any more, so this is a step back into the
    // scanner. Testing for an empty query string instead would strand the
    // user on a stale view whenever an unrelated parameter is present.
    try {
      sessionStorage.removeItem('qrapp_created');
    } catch {}
    if (resumeScanView) {
      resumeScanView();
    } else {
      // This load started in install mode, so the scan flow was never wired
      // up; a reload is the only way to get a working viewfinder.
      location.reload();
    }
  }
});

// ---------------------------------------------------------------------------
// Entry point. Declared last so every module-level binding above is
// initialized before any mode runs.
// ---------------------------------------------------------------------------
function boot() {
  if (isLaunchMode) {
    runLaunch(params);
  } else if (params) {
    runInstallView(params);
  } else {
    runScanFlow();
  }
}

boot();
