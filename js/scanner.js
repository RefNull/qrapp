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

    if ('BarcodeDetector' in window) {
      try {
        this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        this.detector = null;
      }
    }
  }

  async start() {
    this.stopped = false;
    this.detected = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
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

    this.video.srcObject = this.stream;

    // Reveal video only after the first frame has begun playing, avoiding
    // WebKit's transient intrinsic rectangular sizing glitch.
    const onPlaying = () => {
      this.video.classList.add('ready');
      this.video.removeEventListener('playing', onPlaying);
    };
    this.video.addEventListener('playing', onPlaying);

    try {
      await this.video.play();
    } catch (err) {
      this.video.removeEventListener('playing', onPlaying);
      this.onError?.(err);
      return;
    }

    this._checkTorchSupport();
    this._loop();
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
