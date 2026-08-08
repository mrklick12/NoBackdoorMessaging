/* ============================================================
   Dithered desert-horizon background  (Canvas2D)

   The reference art is already a dithered *output*, so this does not sample a
   photo. It generates the underlying scene (black landmass, glowing sky) into
   an offscreen buffer, then runs the real pipeline over it:

     1. procedural scene  -> offscreen canvas at full viewport size
     2. split into cellSize cells, average luminance per cell
     3. brightness / contrast / saturation / grayscale
     4. per frame: wave-animate luminance, 8x8 Bayer ordered dither,
        draw a uniform dot per lit cell
     5. post: bloom, vignette

   Generating rather than upscaling means it fills any screen at any size with
   no interpolation blur. The cell grid is rebuilt only on resize; per frame we
   only re-dither, and lit cells are batched into a few paths so a 1920x1080
   viewport is a handful of fill() calls instead of ~25k fillRect() calls.
   ============================================================ */

(function () {
  "use strict";

  var canvas = document.getElementById("ascii-bg");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  var CFG = {
    cellSize:      10,    // grid pitch (dot size per tone bucket, see BUCKET_DOT)
    cutoff:        0.13,  // below this dithered value a cell stays empty

    brightness:    12,    // -100..100
    contrast:      115,   // %
    saturation:    100,   // %
    grayscale:     100,   // % (reference art is monochrome)

    bgColor:       "#05070c",
    dotColor:      "255,255,255",

    vignette:      38,
    bloom:         25,

    animSpeed:     100,
    animIntensity: 60,

    horizon:       0.775  // normalised y of the land edge
  };

  /* <canvas id="ascii-bg" data-quiet> — same scene pushed further back, for
     pages where a form is the point and the art must not compete with it:
     dimmer, sparser, barely moving, heavier vignette, no bloom. */
  if (canvas.hasAttribute("data-quiet")) {
    CFG.brightness    = -20;
    CFG.contrast      = 106;
    CFG.cutoff        = 0.22;
    CFG.bloom         = 0;
    CFG.vignette      = 64;
    CFG.animSpeed     = 30;
    CFG.animIntensity = 26;
  }

  /* 8x8 ordered (Bayer) dither matrix, 0..63 */
  var BAYER = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
  ];

  /* Three tone buckets — batching by bucket keeps this to 3 fill() calls.
     Dim/mid draw a uniform dot; the brightest fills its whole cell so adjacent
     bright cells tile into solid white, as they do in the reference art. */
  var BUCKET_ALPHA = [0.42, 0.72, 1.0];
  var BUCKET_DOT   = [0.58, 0.68, 1.0];

  var W = 0, H = 0, cols = 0, rows = 0;
  var lum = null;
  var vignetteGrad = null;
  var srcCanvas = document.createElement("canvas");
  var srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  var bloomCanvas = document.createElement("canvas");
  var bloomCtx = bloomCanvas.getContext("2d");
  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* ---------- the scene ---------- */

  /* Normalised y of the top edge of the landmass at horizontal position nx.
     Flat-ish desert floor on the left, a hard notch at ~0.62, a raised mesa
     filling the right side and sloping back down toward the edge. */
  function terrainY(nx) {
    var y = CFG.horizon;

    /* gentle dune undulation */
    y += Math.sin(nx * 6.4 + 0.8) * 0.010;
    y += Math.sin(nx * 17.3 + 2.1) * 0.004;

    /* land rises slightly at the far left */
    y -= smoothstep(0.16, 0.0, nx) * 0.030;

    /* mesa on the right: sharp leading edge, then a slow descent */
    var mesaTop = 0.560 + smoothstep(0.66, 1.0, nx) * 0.150;
    y += (mesaTop - y) * smoothstep(0.610, 0.640, nx);

    return y;
  }

  function drawTree(c, w, h, nx, scale) {
    var gy = terrainY(nx) * h;
    var gx = nx * w;
    var s = scale * h;

    c.fillStyle = "#000";
    /* trunk */
    c.fillRect(gx - s * 0.035, gy - s * 0.95, s * 0.07, s * 0.95);
    /* arms / canopy — a few stubby blocks reading as a Joshua tree */
    c.fillRect(gx - s * 0.30, gy - s * 1.02, s * 0.24, s * 0.09);
    c.fillRect(gx + s * 0.06, gy - s * 1.10, s * 0.26, s * 0.09);
    c.fillRect(gx - s * 0.30, gy - s * 1.30, s * 0.09, s * 0.30);
    c.fillRect(gx + s * 0.23, gy - s * 1.38, s * 0.09, s * 0.34);
    c.beginPath();
    c.arc(gx, gy - s * 1.24, s * 0.20, 0, Math.PI * 2);
    c.fill();
  }

  function drawScene(c, w, h) {
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);

    /* --- main horizon glow, centred left-of-middle --- */
    var g1 = c.createRadialGradient(
      w * 0.44, h * CFG.horizon, 0,
      w * 0.44, h * CFG.horizon, Math.max(w, h) * 0.62
    );
    g1.addColorStop(0.00, "rgba(255,255,255,1.00)");
    g1.addColorStop(0.16, "rgba(255,255,255,0.70)");
    g1.addColorStop(0.38, "rgba(255,255,255,0.28)");
    g1.addColorStop(0.68, "rgba(255,255,255,0.07)");
    g1.addColorStop(1.00, "rgba(255,255,255,0.00)");
    c.fillStyle = g1;
    c.fillRect(0, 0, w, h);

    /* --- fainter secondary glow above the right-hand mesa --- */
    var g2 = c.createRadialGradient(
      w * 0.80, h * 0.56, 0,
      w * 0.80, h * 0.56, Math.max(w, h) * 0.34
    );
    g2.addColorStop(0.00, "rgba(255,255,255,0.42)");
    g2.addColorStop(0.45, "rgba(255,255,255,0.12)");
    g2.addColorStop(1.00, "rgba(255,255,255,0.00)");
    c.fillStyle = g2;
    c.fillRect(0, 0, w, h);

    /* --- diagonal streaks across the sky --- */
    var streak = c.createLinearGradient(0, h, w, 0);
    for (var i = 0; i <= 26; i++) {
      var t = i / 26;
      streak.addColorStop(t, i % 2 ? "rgba(255,255,255,0.055)"
                                  : "rgba(255,255,255,0.000)");
    }
    c.fillStyle = streak;
    c.fillRect(0, 0, w, h);

    /* --- landmass silhouette --- */
    c.fillStyle = "#000";
    c.beginPath();
    c.moveTo(0, h);
    var step = 2;
    for (var x = 0; x <= w; x += step) {
      c.lineTo(x, terrainY(x / w) * h);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fill();

    /* --- trees on the desert floor --- */
    drawTree(c, w, h, 0.245, 0.075);
    drawTree(c, w, h, 0.435, 0.048);
  }

  /* ---------- colour adjustments ---------- */

  function adjustChannel(v) {
    v = v + (CFG.brightness / 100) * 128;
    v = (v - 128) * (CFG.contrast / 100) + 128;
    return clamp(v, 0, 255);
  }

  /* ---------- build the cell grid ---------- */

  function buildGrid() {
    var cs = CFG.cellSize;
    cols = Math.ceil(W / cs);
    rows = Math.ceil(H / cs);

    srcCanvas.width = W;
    srcCanvas.height = H;
    drawScene(srcCtx, W, H);

    var data = srcCtx.getImageData(0, 0, W, H).data;
    lum = new Float32Array(cols * rows);

    for (var cy = 0; cy < rows; cy++) {
      for (var cx = 0; cx < cols; cx++) {
        var x0 = cx * cs, y0 = cy * cs;
        var x1 = Math.min(x0 + cs, W), y1 = Math.min(y0 + cs, H);
        var r = 0, g = 0, b = 0, n = 0;

        for (var y = y0; y < y1; y += 2) {
          var rowOff = y * W;
          for (var x = x0; x < x1; x += 2) {
            var i = (rowOff + x) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2];
            n++;
          }
        }
        if (n === 0) n = 1;

        var R = adjustChannel(r / n),
            G = adjustChannel(g / n),
            B = adjustChannel(b / n);

        var l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        var sat = CFG.saturation / 100;
        var gs  = CFG.grayscale / 100;
        R = l + (R - l) * sat; G = l + (G - l) * sat; B = l + (B - l) * sat;
        R = R + (l - R) * gs;  G = G + (l - G) * gs;  B = B + (l - B) * gs;

        lum[cy * cols + cx] = clamp((0.2126 * R + 0.7152 * G + 0.0722 * B) / 255, 0, 1);
      }
    }

    bloomCanvas.width = W;
    bloomCanvas.height = H;

    vignetteGrad = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.22,
      W / 2, H / 2, Math.max(W, H) * 0.72
    );
    vignetteGrad.addColorStop(0, "rgba(0,0,0,0)");
    vignetteGrad.addColorStop(1, "rgba(0,0,0," + (CFG.vignette / 100).toFixed(3) + ")");
  }

  /* ---------- draw ---------- */

  function render(nowMs) {
    if (!lum) return;
    var t = nowMs * 0.001;
    var cs = CFG.cellSize;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.fillStyle = CFG.bgColor;
    ctx.fillRect(0, 0, W, H);

    bloomCtx.clearRect(0, 0, W, H);

    var amp   = reduceMotion ? 0 : (CFG.animIntensity / 100) * 0.30;
    var speed = (CFG.animSpeed / 100) * 1.15;

    /* collect lit cells per alpha bucket, then fill each bucket in one path */
    var paths = [[], [], []];

    for (var cy = 0; cy < rows; cy++) {
      for (var cx = 0; cx < cols; cx++) {
        var base = lum[cy * cols + cx];
        if (base <= 0.001) continue;   /* silhouette stays pure black */

        /* wave scaled by luminance so the black landmass never sparkles */
        var v = base + Math.sin(cx * 0.16 + cy * 0.26 - t * speed) * amp * base;

        var bt = BAYER[(cy & 7) * 8 + (cx & 7)] / 64;
        var dv = v + (bt - 0.5) * 0.62;   /* ordered dither perturbation */
        if (dv < CFG.cutoff) continue;

        var bucket = dv < 0.42 ? 0 : (dv < 0.80 ? 1 : 2);
        paths[bucket].push(cx * cs, cy * cs);
      }
    }

    for (var b = 0; b < 3; b++) {
      var pts = paths[b];
      if (!pts.length) continue;

      var dot = cs * BUCKET_DOT[b];
      var off = (cs - dot) * 0.5;

      ctx.globalAlpha = BUCKET_ALPHA[b];
      ctx.fillStyle = "rgb(" + CFG.dotColor + ")";
      ctx.beginPath();
      for (var i = 0; i < pts.length; i += 2) {
        ctx.rect(pts[i] + off, pts[i + 1] + off, dot, dot);
      }
      ctx.fill();

      /* brightest bucket feeds the bloom pass */
      if (b === 2) {
        bloomCtx.globalAlpha = 1;
        bloomCtx.fillStyle = "rgb(" + CFG.dotColor + ")";
        bloomCtx.beginPath();
        for (var j = 0; j < pts.length; j += 2) {
          bloomCtx.rect(pts[j] + off, pts[j + 1] + off, dot, dot);
        }
        bloomCtx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (CFG.bloom > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = CFG.bloom / 100;
      ctx.filter = "blur(8px)";
      ctx.drawImage(bloomCanvas, 0, 0);
      ctx.restore();
      ctx.filter = "none";
    }

    if (CFG.vignette > 0 && vignetteGrad) {
      ctx.fillStyle = vignetteGrad;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- plumbing ---------- */

  function resize() {
    W = canvas.clientWidth  || window.innerWidth  || 0;
    H = canvas.clientHeight || window.innerHeight || 0;
    /* Not laid out yet (stylesheet loading, tab hidden, 0x0 viewport).
       Leave the grid null; loop() retries on the next frame. */
    if (W < 1 || H < 1) { lum = null; return; }
    canvas.width = W;
    canvas.height = H;
    buildGrid();
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  function loop(now) {
    if (!lum) resize();   /* cheap no-op once the grid exists */
    render(now);
    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();
