// Graceful, modest particle field traversing around the center focal zone
// to indicate the scanner is actively seeking a QR code.
export function startParticles(canvas) {
  const ctx = canvas.getContext('2d');
  let raf = null;
  let particles = [];
  let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  let isConverging = false;
  let convergeTarget = null;
  let convergeProgress = 0;

  function resize() {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const minDim = Math.min(w, h);
    // Modest count: 28 to 36 particles around the center
    const count = Math.max(26, Math.min(36, Math.round(minDim / 12)));
    particles = Array.from({ length: count }, (_, i) => spawn(i, count));
  }

  function spawn(index = 0, total = 30) {
    const minDim = Math.min(w, h) || 320;
    // Focal center: slightly above mathematical center to align with camera viewfinder
    const cx = w / 2;
    const cy = h * 0.48;

    // Radius distributed around the center focal zone (roughly 70px to 170px on phones)
    const baseRadius = minDim * (0.18 + Math.random() * 0.26);
    const angle = (index / total) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const speed = (0.003 + Math.random() * 0.007) * (Math.random() < 0.5 ? 1 : -1);

    return {
      cx,
      cy,
      angle,
      baseRadius,
      radius: baseRadius,
      radialDriftFreq: 0.001 + Math.random() * 0.002,
      radialDriftAmp: minDim * (0.03 + Math.random() * 0.05),
      speed,
      size: 1.0 + Math.random() * 1.8,
      alpha: 0,
      targetAlpha: 0.25 + Math.random() * 0.55,
      fadeSpeed: 0.015 + Math.random() * 0.02,
      state: 'fading-in',
      life: 0,
      maxLife: 300 + Math.random() * 400,
      // Luminous pearl/cyan tones
      hue: 200 + Math.random() * 25,
      sat: 60 + Math.random() * 30,
      light: 85 + Math.random() * 10,
      x: cx + Math.cos(angle) * baseRadius,
      y: cy + Math.sin(angle) * baseRadius,
    };
  }

  function tick() {
    ctx.clearRect(0, 0, w, h);

    const focalX = w / 2;
    const focalY = h * 0.48;

    if (isConverging && convergeTarget) {
      convergeProgress = Math.min(1, convergeProgress + 0.08);
      const ease = 1 - Math.pow(1 - convergeProgress, 3);

      for (const p of particles) {
        p.x += (convergeTarget.x - p.x) * 0.18;
        p.y += (convergeTarget.y - p.y) * 0.18;
        p.alpha = Math.max(0, p.alpha * (1 - ease * 0.1));

        ctx.beginPath();
        ctx.fillStyle = `hsla(150, 90%, 75%, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.size * (1 + ease * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life++;

        // Fade in / out lifecycle
        if (p.state === 'fading-in') {
          p.alpha += p.fadeSpeed;
          if (p.alpha >= p.targetAlpha) {
            p.alpha = p.targetAlpha;
            p.state = 'active';
          }
        } else if (p.state === 'active' && p.life > p.maxLife) {
          p.state = 'fading-out';
        } else if (p.state === 'fading-out') {
          p.alpha -= p.fadeSpeed;
          if (p.alpha <= 0) {
            particles[i] = spawn(i, particles.length);
            continue;
          }
        }

        // Graceful orbital traversal around the center
        p.angle += p.speed;
        const radialOffset = Math.sin(p.life * p.radialDriftFreq) * p.radialDriftAmp;
        const currentR = p.baseRadius + radialOffset;

        p.x = focalX + Math.cos(p.angle) * currentR;
        p.y = focalY + Math.sin(p.angle) * (currentR * 0.94); // subtle vertical squash for screen balance

        // Draw soft luminous particle
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, ${p.sat}%, ${p.light}%, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Subtle soft halo on larger particles
        if (p.size > 2.0 && p.alpha > 0.3) {
          ctx.beginPath();
          ctx.fillStyle = `hsla(${p.hue}, 90%, 80%, ${p.alpha * 0.2})`;
          ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    raf = requestAnimationFrame(tick);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  tick();

  const controller = function stop() {
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
    ctx.clearRect(0, 0, w, h);
  };

  controller.converge = function (target) {
    isConverging = true;
    convergeProgress = 0;
    convergeTarget = target || { x: w / 2, y: h * 0.48 };
  };

  return controller;
}
