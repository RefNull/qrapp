import { Scanner } from './scanner.js?v=12';
import { startParticles } from './particles.js?v=12';
import { encodeAppUrl, decodeAppParams, isStandalone, normalizeUrl } from './appstate.js?v=12';
import { faviconCandidates, firstLoadableFavicon } from './favicon.js?v=12';
import { searchIcons, iconSvgUrl } from './iconify.js?v=12';
import { renderIconToCanvas, renderPlaceholderIcon, buildIconDataUri } from './iconBuilder.js?v=12';
import { buildManifestDataUri, applyManifestLink, applyIOSMeta } from './manifestBuilder.js?v=12';
import { renderQrToCanvas } from './qrEncode.js?v=12';

const $ = (id) => document.getElementById(id);
const views = ['scan', 'customize', 'install'].reduce((m, k) => {
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

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
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
  const sat = hue === 0 ? 0 : 65;
  return colorToHex(hue, sat, light);
}

function hexToHsl(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h = Math.round(h * 60);
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

// ---------------------------------------------------------------------------
// Bottom Sheet Helper
// ---------------------------------------------------------------------------
function setupBottomSheet({ backdropId, containerId, handleId, closeBtnId, onOpen, onClose }) {
  const backdrop = $(backdropId);
  const container = $(containerId);
  const handle = $(handleId);
  const closeBtn = $(closeBtnId);
  if (!backdrop || !container) return { open: () => {}, close: () => {} };

  function open() {
    if (onOpen) onOpen();
    backdrop.hidden = false;
    void backdrop.offsetWidth;
    backdrop.classList.add('active');
  }

  function close() {
    if (backdrop.hidden) return;
    backdrop.classList.remove('active');
    if (container) container.style.transform = '';
    setTimeout(() => {
      backdrop.hidden = true;
      if (onClose) onClose();
    }, 280);
  }

  if (closeBtn) closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.hidden) close();
  });

  if (handle && container) {
    let startY = 0;
    let diffY = 0;
    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      diffY = 0;
      container.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      diffY = e.touches[0].clientY - startY;
      if (diffY > 0) {
        container.style.transform = `translateY(${diffY}px)`;
      }
    }, { passive: true });

    handle.addEventListener('touchend', () => {
      container.style.transition = '';
      if (diffY > 75) {
        close();
      } else {
        container.style.transform = '';
      }
    });
  }

  return { open, close };
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
// Entry detection
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
const isLaunchMode = Boolean(
  params && (isStandalone() || searchParams.has('launch')) && !isCreatedInThisSession
);

// ---------------------------------------------------------------------------
// Mode: launched from home screen icon -> redirect immediately.
// ---------------------------------------------------------------------------
function runLaunch(cfg) {
  if (cfg.transition === 'instant') {
    location.replace(cfg.targetUrl);
    return;
  }
  const transitionClass = cfg.transition === 'slide' ? 'launch-slide' : 'launch-fade';
  document.body.innerHTML = `<div class="${transitionClass}"><img id="launch-icon" alt=""></div>`;
  const img = $('launch-icon');

  const placeholderCanvas = document.createElement('canvas');
  placeholderCanvas.width = placeholderCanvas.height = 160;
  img.src = renderPlaceholderIcon(placeholderCanvas, {
    bgColor: cfg.bgColor,
    fgColor: cfg.fgColor,
    label: cfg.name,
    fontStyle: cfg.fontStyle || 'sans',
  });

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
  applyForInstall(
    cfg,
    renderPlaceholderIcon(canvas, {
      bgColor: cfg.bgColor,
      fgColor: cfg.fgColor,
      label: cfg.name,
      fontStyle: cfg.fontStyle || 'sans',
    })
  );

  const opts = iconOptsFor(cfg);
  const { tainted } = await renderIconToCanvas(canvas, opts);
  applyForInstall(cfg, tainted ? opts.sourceValue : canvas.toDataURL('image/png'));

  const plat = platform();
  if (plat === 'ios') {
    $('install-ios').hidden = false;
    $('install-android').hidden = true;
    $('install-android-fallback').hidden = true;
    $('install-generic').hidden = true;
  } else if (plat === 'android') {
    $('install-ios').hidden = true;
    $('install-generic').hidden = true;
    if (deferredInstallPrompt) {
      $('install-android').hidden = false;
      $('install-android-fallback').hidden = true;
    } else {
      $('install-android').hidden = false;
      $('install-android-fallback').hidden = true;
      setTimeout(() => {
        if (!deferredInstallPrompt) {
          $('install-android').hidden = true;
          $('install-android-fallback').hidden = false;
        }
      }, 1200);
    }
  } else {
    $('install-ios').hidden = true;
    $('install-android').hidden = true;
    $('install-android-fallback').hidden = true;
    $('install-generic').hidden = false;
  }

  // Reset in-person QR toggle state
  const qrBox = $('install-qr-box');
  const toggleQrBtn = $('btn-toggle-qr');
  if (qrBox) qrBox.hidden = true;
  if (toggleQrBtn) {
    const textSpan = toggleQrBtn.querySelector('span');
    if (textSpan) textSpan.textContent = 'Show QR Code 📱';
  }

  if (!installViewInitialized) {
    installViewInitialized = true;

    $('btn-install-android')?.addEventListener('click', () => showChromeInstallPrompt());

    const shareBtn = $('btn-install-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const currentCfg = activeInstallCfg || params || {};
        const shareUrl = encodeAppUrl(currentCfg);
        const shareTitle = currentCfg.name || 'App';
        const shareData = {
          title: shareTitle,
          text: `Install ${shareTitle} on your home screen`,
          url: shareUrl,
        };

        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            return;
          } catch (err) {
            if (err.name === 'AbortError') return;
          }
        }

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

    if (toggleQrBtn && qrBox) {
      toggleQrBtn.addEventListener('click', () => {
        const isHidden = qrBox.hidden;
        qrBox.hidden = !isHidden;
        const textSpan = toggleQrBtn.querySelector('span');
        if (textSpan) {
          textSpan.textContent = isHidden ? 'Hide QR Code ✕' : 'Show QR Code 📱';
        }
        if (isHidden) {
          const qrCanvas = $('install-qr-canvas');
          const shareUrl = encodeAppUrl(activeInstallCfg || params || {});
          renderQrToCanvas(qrCanvas, shareUrl, { size: 200, margin: 2 });
        }
      });
    }

    $('btn-install-restart')?.addEventListener('click', () => {
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
    fontStyle: cfg.fontStyle || 'sans',
  };
}

// Global resume reference for history navigation
let resumeScanView = null;

// ---------------------------------------------------------------------------
// Mode: scanner & unified studio flow
// ---------------------------------------------------------------------------
function runScanFlow() {
  // Dynamically set manifest.json in scanner mode so Chrome PWA install works
  const manifestLink = $('link-manifest');
  if (manifestLink) manifestLink.href = 'manifest.json';

  showView('scan');
  let stopParticles = startParticles($('particles'));

  const state = {
    targetUrl: '',
    name: '',
    bgHue: 215,
    bgLight: 45,
    bgColor: '#2563eb',
    fgHue: 0,
    fgLight: 100,
    fgColor: '#ffffff',
    iconSource: 'favicon',
    fontStyle: 'sans',
    iconValue: '',
    faviconValue: '',
    iconifyValue: '',
    iconUpload: '',
    transition: 'fade',
  };

  // -------------------- Bottom Sheets Setup --------------------
  const installSheet = setupBottomSheet({
    backdropId: 'install-sheet-backdrop',
    containerId: 'install-sheet',
    handleId: 'sheet-handle-bar',
    closeBtnId: 'btn-close-sheet',
    onOpen: () => {
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
    },
  });

  $('btn-sheet-install-android')?.addEventListener('click', async () => {
    await showChromeInstallPrompt();
    installSheet.close();
  });

  const menuSheet = setupBottomSheet({
    backdropId: 'menu-sheet-backdrop',
    containerId: 'sheet-menu',
    handleId: 'menu-sheet-handle-bar',
    closeBtnId: 'btn-close-menu-sheet',
  });

  $('btn-scanner-menu')?.addEventListener('click', () => {
    menuSheet.open();
  });

  $('btn-menu-install')?.addEventListener('click', () => {
    menuSheet.close();
    setTimeout(() => { installSheet.open(); }, 150);
  });

  const directUrlSheet = setupBottomSheet({
    backdropId: 'direct-url-backdrop',
    containerId: 'modal-direct-url',
    handleId: 'direct-url-handle-bar',
    closeBtnId: 'btn-close-direct-url',
    onOpen: () => {
      const errEl = $('direct-url-error');
      if (errEl) errEl.hidden = true;
      setTimeout(() => $('input-direct-url')?.focus(), 200);
    },
  });

  $('btn-paste-url')?.addEventListener('click', () => {
    directUrlSheet.open();
  });

  $('btn-camera-fallback-url')?.addEventListener('click', () => {
    directUrlSheet.open();
  });

  // Direct URL paste button
  $('btn-clipboard-paste')?.addEventListener('click', async () => {
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          $('input-direct-url').value = text.trim();
          const errEl = $('direct-url-error');
          if (errEl) errEl.hidden = true;
        }
      } catch {}
    }
  });

  // Direct URL quick suggestions
  document.querySelectorAll('.chip-suggestion').forEach((chip) => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.url;
      if (url) {
        $('input-direct-url').value = url;
        submitDirectUrl();
      }
    });
  });

  function submitDirectUrl() {
    const raw = $('input-direct-url')?.value || '';
    const cleanUrl = normalizeUrl(raw);
    const errEl = $('direct-url-error');
    if (!cleanUrl) {
      if (errEl) {
        errEl.textContent = 'Please enter a valid website address (e.g. https://example.com)';
        errEl.hidden = false;
      }
      return;
    }
    if (errEl) errEl.hidden = true;
    directUrlSheet.close();
    scanner.stop();
    if (stopParticles) stopParticles();
    enterCustomize(cleanUrl);
  }

  $('btn-submit-direct-url')?.addEventListener('click', submitDirectUrl);
  $('input-direct-url')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDirectUrl();
    }
  });

  // Scan photo from library
  const photoInput = $('input-photo-scan');
  $('btn-scan-photo')?.addEventListener('click', () => {
    photoInput?.click();
  });

  photoInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await Scanner.scanImage(file);
      if (result) {
        const cleanUrl = normalizeUrl(result);
        if (cleanUrl) {
          scanner.stop();
          if (stopParticles) stopParticles();
          enterCustomize(cleanUrl);
          return;
        }
      }
      alert('No QR code found in this photo. Please choose a clearer image.');
    } catch {
      alert("Could not process this image file.");
    } finally {
      e.target.value = '';
    }
  });

  // -------------------- Scanner Instance --------------------
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
        enterCustomize(cleanUrl);
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

  $('btn-camera-retry')?.addEventListener('click', () => {
    const errorCard = $('scan-error-card');
    if (errorCard) errorCard.hidden = true;
    $('btn-camera-retry').hidden = true;
    const pillText = $('scan-title');
    if (pillText) pillText.textContent = 'Scan QR code';
    scanner.start();
  });

  resumeScanView = () => {
    installSheet.close();
    menuSheet.close();
    directUrlSheet.close();

    const pill = $('scan-pill');
    const pillText = $('scan-title');
    if (pill) pill.classList.remove('locked');
    if (pillText) pillText.textContent = 'Scan QR code';

    showView('scan');
    if (stopParticles) stopParticles();
    stopParticles = startParticles($('particles'));
    scanner.start();
  };

  // -------------------- Unified Studio (Customize) --------------------
  let iconify = { searchTimer: null };
  let mockupRaf = null;

  function updateShadeTrack(sliderId, hue) {
    const slider = $(sliderId);
    if (!slider) return;
    const sat = hue === 0 ? 0 : 65;
    const midColor = `hsl(${hue}, ${sat}%, 50%)`;
    slider.style.background = `linear-gradient(90deg, #000000 0%, ${midColor} 50%, #ffffff 100%)`;
  }

  function setBgColor(hex) {
    state.bgColor = hex.toLowerCase();
    $('label-bg-hex').textContent = state.bgColor;
    $('input-bg-color-picker').value = state.bgColor;
    $('swatch-bg').style.background = state.bgColor;
    const { h, l } = hexToHsl(state.bgColor);
    state.bgHue = h;
    state.bgLight = l;
    $('slider-bg-hue').value = h;
    $('slider-bg-light').value = l;
    updateShadeTrack('slider-bg-light', h);
    document.querySelectorAll('#chips-bg .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.hex.toLowerCase() === state.bgColor);
    });
    scheduleMockupUpdate();
  }

  function setFgColor(hex) {
    state.fgColor = hex.toLowerCase();
    $('label-fg-hex').textContent = state.fgColor;
    $('input-fg-color-picker').value = state.fgColor;
    $('swatch-fg').style.background = state.fgColor;
    const { h, l } = hexToHsl(state.fgColor);
    state.fgHue = h;
    state.fgLight = l;
    $('slider-fg-hue').value = h;
    $('slider-fg-light').value = l;
    updateShadeTrack('slider-fg-light', h);
    document.querySelectorAll('#chips-fg .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.hex.toLowerCase() === state.fgColor);
    });
    scheduleMockupUpdate();
  }

  function enterCustomize(url) {
    installSheet.close();
    menuSheet.close();
    directUrlSheet.close();

    const cleanUrl = normalizeUrl(url);
    state.targetUrl = cleanUrl;
    state.faviconValue = '';
    state.iconifyValue = '';
    state.iconUpload = '';
    state.iconSource = 'favicon';
    state.fontStyle = 'sans';
    state.transition = 'fade';

    let host = 'App';
    try {
      host = new URL(cleanUrl).hostname.replace(/^www\./, '');
    } catch {}
    state.name = host;

    // Destination card
    $('customize-host').textContent = host;
    $('customize-url').textContent = cleanUrl;
    $('btn-verify-link').onclick = () => window.open(cleanUrl, '_blank', 'noopener,noreferrer');

    $('input-name').value = state.name;

    // Reset tabs
    document.querySelectorAll('#icon-source-tabs .tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.source === 'favicon');
    });
    ['favicon', 'monogram', 'iconify', 'upload'].forEach((s) => {
      const p = $(`panel-${s}`);
      if (p) p.hidden = s !== 'favicon';
    });

    // Reset monogram fonts
    document.querySelectorAll('#monogram-font-chips .segment').forEach((s) => {
      s.classList.toggle('active', s.dataset.font === 'sans');
    });

    // Reset transition
    document.querySelectorAll('#control-transition .segment').forEach((s) => {
      s.classList.toggle('active', s.dataset.transition === 'fade');
    });

    // Reset colors
    setBgColor('#2563eb');
    setFgColor('#ffffff');

    updateColorFieldVisibility();

    // Reset favicon thumbnail
    const thumb = $('favicon-preview-thumb');
    if (thumb) thumb.src = 'icons/favicon.svg';

    loadFaviconCandidates();

    scheduleMockupUpdate();
    showView('customize');
  }

  $('btn-customize-back')?.addEventListener('click', () => resumeScanView());

  $('input-name')?.addEventListener('input', (e) => {
    state.name = e.target.value || 'App';
    scheduleMockupUpdate();
  });

  function updateColorFieldVisibility() {
    $('field-bg-color').hidden = state.iconSource === 'favicon';
    $('field-fg-color').hidden = state.iconSource !== 'iconify' && state.iconSource !== 'monogram';
  }

  // Icon source tabs
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

  // Monogram font options
  document.querySelectorAll('#monogram-font-chips .segment').forEach((seg) => {
    seg.addEventListener('click', () => {
      document.querySelectorAll('#monogram-font-chips .segment').forEach((s) => s.classList.remove('active'));
      seg.classList.add('active');
      state.fontStyle = seg.dataset.font || 'sans';
      scheduleMockupUpdate();
    });
  });

  // Launch experience selector
  document.querySelectorAll('#control-transition .segment').forEach((seg) => {
    seg.addEventListener('click', () => {
      document.querySelectorAll('#control-transition .segment').forEach((s) => s.classList.remove('active'));
      seg.classList.add('active');
      state.transition = seg.dataset.transition || 'fade';
    });
  });

  function iconValueForSource(source) {
    if (source === 'favicon') return state.faviconValue;
    if (source === 'iconify') return state.iconifyValue;
    return '';
  }

  async function loadFaviconCandidates() {
    const requestedUrl = state.targetUrl;
    const best = await firstLoadableFavicon(faviconCandidates(requestedUrl));
    if (best && state.targetUrl === requestedUrl) {
      state.faviconValue = best;
      if (state.iconSource === 'favicon') state.iconValue = best;
      const thumb = $('favicon-preview-thumb');
      if (thumb) thumb.src = best;
      scheduleMockupUpdate();
    }
  }

  $('btn-refetch-favicon')?.addEventListener('click', () => {
    loadFaviconCandidates();
  });

  // Iconify search
  $('iconify-search')?.addEventListener('input', (e) => {
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

  // Upload handling
  const UPLOAD_URI_BUDGET = 6000;
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

  $('upload-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
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
            ? 'This image is very detailed, so the share link will be long. A simpler logo works better.'
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

  // Palette and Pickers
  document.querySelectorAll('#chips-bg .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.hex) setBgColor(btn.dataset.hex);
    });
  });

  $('input-bg-color-picker')?.addEventListener('input', (e) => {
    setBgColor(e.target.value);
  });

  document.querySelectorAll('#chips-fg .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.hex) setFgColor(btn.dataset.hex);
    });
  });

  $('input-fg-color-picker')?.addEventListener('input', (e) => {
    setFgColor(e.target.value);
  });

  // Sliders fine-tune
  function recomputeBgFromSliders() {
    state.bgColor = calcColor(state.bgHue, state.bgLight);
    $('label-bg-hex').textContent = state.bgColor;
    $('input-bg-color-picker').value = state.bgColor;
    $('swatch-bg').style.background = state.bgColor;
    updateShadeTrack('slider-bg-light', state.bgHue);
    document.querySelectorAll('#chips-bg .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.hex.toLowerCase() === state.bgColor);
    });
    scheduleMockupUpdate();
  }

  function recomputeFgFromSliders() {
    state.fgColor = calcColor(state.fgHue, state.fgLight);
    $('label-fg-hex').textContent = state.fgColor;
    $('input-fg-color-picker').value = state.fgColor;
    $('swatch-fg').style.background = state.fgColor;
    updateShadeTrack('slider-fg-light', state.fgHue);
    document.querySelectorAll('#chips-fg .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.hex.toLowerCase() === state.fgColor);
    });
    scheduleMockupUpdate();
  }

  $('slider-bg-hue')?.addEventListener('input', (e) => {
    state.bgHue = Number(e.target.value);
    recomputeBgFromSliders();
  });
  $('slider-bg-light')?.addEventListener('input', (e) => {
    state.bgLight = Number(e.target.value);
    recomputeBgFromSliders();
  });
  $('slider-fg-hue')?.addEventListener('input', (e) => {
    state.fgHue = Number(e.target.value);
    recomputeFgFromSliders();
  });
  $('slider-fg-light')?.addEventListener('input', (e) => {
    state.fgLight = Number(e.target.value);
    recomputeFgFromSliders();
  });

  // Live mockups update
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

  // Create App -> Transition to Install View
  $('btn-customize-next')?.addEventListener('click', () => {
    const installUrl = encodeAppUrl(state);
    try {
      sessionStorage.setItem('qrapp_created', '1');
    } catch {}
    history.pushState({ view: 'install', cfg: { ...state } }, '', installUrl);
    runInstallView(state);
  });
}

// ---------------------------------------------------------------------------
// History / Popstate handling
// ---------------------------------------------------------------------------
window.addEventListener('popstate', (e) => {
  if (e.state && e.state.view) {
    if (e.state.view === 'install' && e.state.cfg) {
      runInstallView(e.state.cfg);
    } else {
      showView(e.state.view);
    }
  } else if (!decodeAppParams(new URLSearchParams(location.search))) {
    try {
      sessionStorage.removeItem('qrapp_created');
    } catch {}
    if (resumeScanView) {
      resumeScanView();
    } else {
      location.reload();
    }
  }
});

// ---------------------------------------------------------------------------
// Service Worker Registration
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Boot
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
