// Camera capture + QR decode. Prefers the native BarcodeDetector API (fast, no
// library, available on Chrome/Android); falls back to the vendored jsQR for
// browsers that don't implement it (notably Safari/iOS).
export class Scanner {
  constructor(videoEl, { onDetect, onError }) {
    this.video = videoEl;
    this.onDetect = onDetect;
    this.onError = onError;
    this.stream = null;
    this.raf = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = ('BarcodeDetector' in window)
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;
    this.stopped = true;
  }

  async start() {
    this.stopped = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (err) {
      this.onError?.(err);
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this._loop();
  }

  stop() {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  _loop() {
    if (this.stopped) return;
    this._tick().finally(() => {
      if (!this.stopped) this.raf = requestAnimationFrame(() => this._loop());
    });
  }

  async _tick() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;

    if (this.detector) {
      try {
        const codes = await this.detector.detect(v);
        if (codes.length) {
          this.onDetect(codes[0].rawValue);
        }
      } catch {
        // fall through, will retry next frame
      }
      return;
    }

    // jsQR fallback: draw the current frame to a canvas and decode pixels.
    const w = (this.canvas.width = v.videoWidth);
    const h = (this.canvas.height = v.videoHeight);
    this.ctx.drawImage(v, 0, 0, w, h);
    const imageData = this.ctx.getImageData(0, 0, w, h);
    const result = window.jsQR?.(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
    if (result?.data) {
      this.onDetect(result.data);
    }
  }
}
