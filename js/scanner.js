// Camera capture + QR decode. Prefers the native BarcodeDetector API (fast, no
// library, available on Chrome/Android); falls back to the vendored jsQR for
// browsers that don't implement it (notably Safari/iOS).
export class Scanner {
  constructor(videoEl, { onDetect, onError, onTorchChange }) {
    this.video = videoEl;
    this.onDetect = onDetect;
    this.onError = onError;
    this.onTorchChange = onTorchChange;
    this.stream = null;
    this.raf = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = null;
    this.stopped = true;
    this.detected = false;
    this.torchActive = false;
    this.lastScanTime = 0;
    this.starting = false;

    if ('BarcodeDetector' in window) {
      try {
        this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        this.detector = null;
      }
    }
  }

  // Static helper to decode a QR code from an image source (HTMLImageElement,
  // HTMLCanvasElement, or ImageData) using BarcodeDetector with jsQR fallback.
  static async scanImage(source) {
    if (!source) return null;

    // 1. Try native BarcodeDetector if supported
    if ('BarcodeDetector' in window) {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(source);
        if (codes && codes.length > 0 && codes[0]?.rawValue) {
          return codes[0].rawValue;
        }
      } catch {
        // Fall back to jsQR
      }
    }

    // 2. jsQR fallback
    if (!window.jsQR) return null;

    if ((typeof ImageData !== 'undefined' && source instanceof ImageData) || (source && source.data && source.width && source.height && typeof source.getContext !== 'function')) {
      const result = window.jsQR(source.data, source.width, source.height, {
        inversionAttempts: 'attemptBoth',
      });
      return result?.data || null;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    if (!w || !h) return null;

    // Scale down ultra-high-resolution photos to max 1280px for swift decoding
    const maxDim = 1280;
    let dw = w;
    let dh = h;
    if (dw > maxDim || dh > maxDim) {
      if (dw > dh) {
        dh = Math.round((dh * maxDim) / dw);
        dw = maxDim;
      } else {
        dw = Math.round((dw * maxDim) / dh);
        dh = maxDim;
      }
    }

    canvas.width = dw;
    canvas.height = dh;
    ctx.drawImage(source, 0, 0, dw, dh);
    const imageData = ctx.getImageData(0, 0, dw, dh);
    const result = window.jsQR(imageData.data, dw, dh, {
      inversionAttempts: 'attemptBoth',
    });
    return result?.data || null;
  }

  static async scanImageData(imageData) {
    return Scanner.scanImage(imageData);
  }

  // Safe to call when already running or while a previous call is still
  // awaiting the permission prompt — double-tapping "Enable camera" must not
  // leave an orphaned MediaStream running or start a second scan loop.
  async start() {
    if (this.starting) return;
    this.starting = true;
    try {
      if (this.stream) this.stop();
      this.stopped = false;
      this.detected = false;
      // Hide before awaiting permission: a retry must not leave the previous
      // (frozen, possibly unsized) frame painted while the prompt is up.
      this.video.classList.remove('ready');

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        this.onError?.(err);
        return;
      }

      // stop() may have been called while the prompt was up.
      if (this.stopped) {
        for (const track of stream.getTracks()) {
          try { track.stop(); } catch {}
        }
        return;
      }

      this.stream = stream;
      this.video.srcObject = stream;

      try {
        await this.video.play();
      } catch (err) {
        this.onError?.(err);
        return;
      }

      this._checkTorchSupport();
      this._loop();
      this._waitForVideoReady();
    } finally {
      this.starting = false;
    }
  }

  // The camera element is only revealed once the stream has real intrinsic
  // dimensions. Until videoWidth/videoHeight are known, WebKit lays the media
  // out at the <video> default intrinsic size (300x150) and `object-fit: cover`
  // has nothing to fit against, so the frame paints as a small box letterboxed
  // in black — the "shrinks then snaps to fullscreen" flash QA reported on iOS.
  async _waitForVideoReady() {
    if (this.stopped) return;

    const hasDimensions = () => (
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0 &&
      this.video.readyState >= 2
    );

    await this._pollUntil(hasDimensions, 3000);
    if (this.stopped) return;

    // Dimensions are known; now wait for an actual painted frame so the fade-in
    // never starts on a still-black surface.
    if ('requestVideoFrameCallback' in this.video) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 400);
        this.video.requestVideoFrameCallback(() => {
          clearTimeout(timer);
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    } else {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    if (this.stopped) return;

    // If the poll above timed out without dimensions we still reveal, so a
    // misbehaving camera leaves a letterboxed preview rather than a screen
    // that stays black forever. That is the fallback, not the normal path.
    this.video.classList.add('ready');
  }

  // Resolves as soon as `predicate` holds, re-checking every animation frame,
  // or after `timeoutMs`. A frame-driven poll is used instead of media events
  // because iOS fires loadedmetadata before videoWidth/videoHeight are set.
  // The timer backstop is separate from the frame loop because rAF is paused
  // while the document is hidden, which would otherwise leave this pending.
  _pollUntil(predicate, timeoutMs) {
    return new Promise((resolve) => {
      if (predicate()) {
        resolve(true);
        return;
      }
      let done = false;
      const settle = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => settle(predicate()), timeoutMs);
      const check = () => {
        if (done) return;
        if (this.stopped) {
          settle(false);
          return;
        }
        if (predicate()) {
          settle(true);
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  stop() {
    this.stopped = true;
    this.video.classList.remove('ready');
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.stop(); } catch {}
      }
      this.stream = null;
    }
    this.torchActive = false;
    this.video.srcObject = null;
    this.onTorchChange?.({ supported: false, active: false });
  }

  _getVideoTrack() {
    return this.stream?.getVideoTracks()?.[0] || null;
  }

  _checkTorchSupport() {
    const track = this._getVideoTrack();
    if (!track) return;
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const hasTorch = Boolean(caps.torch);
      this.onTorchChange?.({ supported: hasTorch, active: false });
    } catch {
      this.onTorchChange?.({ supported: false, active: false });
    }
  }

  async toggleTorch(active) {
    const track = this._getVideoTrack();
    if (!track) return false;
    const targetState = typeof active === 'boolean' ? active : !this.torchActive;
    try {
      await track.applyConstraints({
        advanced: [{ torch: targetState }],
      });
      this.torchActive = targetState;
      this.onTorchChange?.({ supported: true, active: this.torchActive });
      return this.torchActive;
    } catch {
      return false;
    }
  }

  _loop() {
    if (this.stopped) return;
    this._tick().finally(() => {
      if (!this.stopped) {
        this.raf = requestAnimationFrame(() => this._loop());
      }
    });
  }

  async _tick() {
    if (this.stopped || this.detected) return;
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;

    if (this.detector) {
      try {
        const codes = await this.detector.detect(v);
        if (codes.length && !this.detected && !this.stopped) {
          this.detected = true;
          this.onDetect(codes[0].rawValue);
        }
      } catch {
        // Fall back to jsQR if detector fails on runtime
        this._scanJsQR(v);
      }
      return;
    }

    // Rate-limit jsQR to ~15fps (every ~66ms) to conserve mobile CPU & battery
    const now = performance.now();
    if (now - this.lastScanTime < 65) return;
    this.lastScanTime = now;

    this._scanJsQR(v);
  }

  _scanJsQR(v) {
    if (!window.jsQR || this.detected || this.stopped) return;

    // Downscale to max 720px for fast decoding without frame-rate stutters
    const maxDim = 720;
    let w = v.videoWidth;
    let h = v.videoHeight;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    this.ctx.drawImage(v, 0, 0, w, h);
    const imageData = this.ctx.getImageData(0, 0, w, h);
    const result = window.jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });

    if (result?.data && !this.detected && !this.stopped) {
      this.detected = true;
      this.onDetect(result.data);
    }
  }
}
