import { Scanner } from './scanner.js';
import { startParticles } from './particles.js';
import { encodeAppUrl, decodeAppParams, isStandalone, normalizeUrl } from './appstate.js';
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

function hueToHex(hue, sat = 70, light = 45) {
  colorCtx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
  colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorCtx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
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
async function runInstallView(cfg) {
  showView('install');
  $('install-app-name').textContent = cfg.name;
  $('install-app-target').textContent = cfg.targetUrl;

  const canvas = $('install-icon-canvas');
  applyForInstall(cfg, renderPlaceholderIcon(canvas, { bgColor: cfg.bgColor, fgColor: cfg.fgColor, label: cfg.name }));

  // Upgrade to the real icon (favicon/iconify/upload) once it's ready, and
  // re-apply — browsers pick up manifest link / meta tag changes, but the
  // start_url above is already correct even if this never finishes in time.
  await renderIconToCanvas(canvas, iconOptsFor(cfg));
  applyForInstall(cfg, canvas.toDataURL('image/png'));

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

  $('btn-install-android').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  const shareBtn = $('btn-install-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const shareUrl = location.href;
      const shareData = {
        title: cfg.name,
        text: `Install ${cfg.name} as an app`,
        url: shareUrl,
      };
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        try {
          await navigator.share(shareData);
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        const originalText = shareBtn.textContent;
        shareBtn.textContent = 'Link copied!';
        setTimeout(() => { shareBtn.textContent = originalText; }, 2000);
      } catch {
        prompt('Copy this link to share the app:', shareUrl);
      }
    });
  }

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
  let stopParticles = startParticles($('particles'));

  const state = {
    targetUrl: '',
    name: '',
    bgHue: 215,
    bgLight: 45,
    bgColor: hueToHex(215, 65, 45),
    fgHue: 0,
    fgLight: 100,
    fgColor: '#ffffff',
    iconSource: 'favicon',
    iconValue: '',
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

  $('btn-preview-back').addEventListener('click', () => {
    closeInstallSheet();
    const pill = $('scan-pill');
    const pillText = $('scan-title');
    if (pill) pill.classList.remove('locked');
    if (pillText) pillText.textContent = 'Scan QR code';

    showView('scan');
    stopParticles = startParticles($('particles'));
    scanner.start();
  });

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
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
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
        btn.innerHTML = `<img src="${iconSvgUrl(id, '#000000')}" alt="${id}">`;
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

  // upload: downscale to max 192x192 PNG to keep URL query strings lightweight (< 8KB)
  $('upload-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 192;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        state.iconUpload = c.toDataURL('image/png');
        scheduleMockupUpdate();
      };
      img.src = reader.result;
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

  const transitionSelect = $('select-transition');
  if (transitionSelect) {
    transitionSelect.addEventListener('change', (e) => {
      state.transition = e.target.value;
    });
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
    const finalUrl = encodeAppUrl('index.html', state);
    location.href = finalUrl;
  });
}
