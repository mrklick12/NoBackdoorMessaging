// Animated dark/dither canvas background for the landing page.
// Reimplements a single fixed look (dither + solid bg + vignette + bloom + wave
// animation) rather than a general-purpose configurable engine, since this page
// never needs the other render modes.

(function () {
  const canvas = document.getElementById("pixel-bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const CELL = 16;
  const BRIGHTNESS = 0.12;     // config brightness: 12
  const CONTRAST = 1.15;       // config contrast: 115%
  const BG_COLOR = "#05070c";
  const DOT_COLOR = "255,255,255";
  const VIGNETTE_INTENSITY = 0.38;
  const BLOOM_INTENSITY = 0.25;
  const WAVE_SPEED = 0.0018;   // derived from animSpeed intensity: 100
  const WAVE_STRENGTH = 0.35;  // derived from animIntensity intensity: 60

  const HORIZON_Y = 0.64;
  const HILL_AMPLITUDE = 0.02;
  const TRUNK_X = [0.24, 0.62];

  let width, height, cols, rows;
  let bloomCanvas, bloomCtx;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    cols = Math.ceil(width / CELL);
    rows = Math.ceil(height / CELL);
    bloomCanvas = document.createElement("canvas");
    bloomCanvas.width = width;
    bloomCanvas.height = height;
    bloomCtx = bloomCanvas.getContext("2d");
  }
  window.addEventListener("resize", resize);
  resize();

  // deterministic hash so stars stay put frame to frame instead of jittering
  function hash(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function sceneLuminance(nx, ny) {
    const hillLine =
      HORIZON_Y +
      Math.sin(nx * 6.0) * HILL_AMPLITUDE +
      Math.sin(nx * 17.0) * HILL_AMPLITUDE * 0.3;

    if (ny > hillLine) return 0; // below the hill line: solid silhouette

    for (const tx of TRUNK_X) {
      if (Math.abs(nx - tx) < 0.006 && ny > hillLine - 0.14) return 0; // thin trunks
    }

    const d = ny - HORIZON_Y;
    const glow = Math.exp(-((d * d) / 0.03)) * 0.85; // horizon glow band

    const cellX = Math.floor(nx * 90);
    const cellY = Math.floor(ny * 50);
    let star = 0;
    if (ny < HORIZON_Y - 0.05 && hash(cellX, cellY) > 0.985) {
      star = 0.6 + hash(cellX + 1, cellY + 1) * 0.4;
    }

    return Math.min(1, 0.02 + glow + star);
  }

  let time = 0;

  function draw() {
    time += WAVE_SPEED;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);
    bloomCtx.clearRect(0, 0, width, height);

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const nx = cx / cols;
        const ny = cy / rows;

        let l = sceneLuminance(nx, ny);

        // wave animation: diagonal traveling brightness ripple
        const wave = Math.sin((nx + ny) * 8 - time) * WAVE_STRENGTH;
        l = Math.max(0, Math.min(1, l + wave * (l > 0 ? 1 : 0.15)));

        l = l + BRIGHTNESS;
        l = (l - 0.5) * CONTRAST + 0.5;
        l = Math.max(0, Math.min(1, l));

        if (l <= 0.03) continue;

        const size = CELL * 0.85 * l;
        const px = cx * CELL + (CELL - size) / 2;
        const py = cy * CELL + (CELL - size) / 2;

        ctx.fillStyle = `rgba(${DOT_COLOR}, ${0.55 + l * 0.45})`;
        ctx.fillRect(px, py, size, size);

        if (l > 0.55) {
          bloomCtx.fillStyle = `rgba(${DOT_COLOR}, ${l})`;
          bloomCtx.fillRect(px, py, size, size);
        }
      }
    }

    ctx.save();
    ctx.filter = "blur(6px)";
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = BLOOM_INTENSITY;
    ctx.drawImage(bloomCanvas, 0, 0);
    ctx.restore();

    const vg = ctx.createRadialGradient(
      width / 2, height / 2, height * 0.25,
      width / 2, height / 2, height * 0.75
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(0,0,0,${VIGNETTE_INTENSITY})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, width, height);

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();
