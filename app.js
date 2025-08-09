(function () {
  // ---------- Math helpers ----------
  const EPS = 1e-7;
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const distSq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  function lineSide(p, n, m) {
    return dot(sub(p, m), n);
  }
  function segLineIntersection(a, b, n, m) {
    const ab = sub(b, a);
    const denom = dot(ab, n);
    if (Math.abs(denom) < EPS) return null; // parallel
    const t = dot(sub(m, a), n) / denom;
    return { point: add(a, mul(ab, t)), t };
  }
  function clipPolygonWithHalfPlane(poly, n, m) {
    if (!poly || poly.length === 0) return [];
    const res = [];
    for (let i = 0; i < poly.length; i++) {
      const curr = poly[i];
      const next = poly[(i + 1) % poly.length];
      const currIn = lineSide(curr, n, m) <= 0;
      const nextIn = lineSide(next, n, m) <= 0;
      if (currIn && nextIn) {
        res.push(next);
      } else if (currIn && !nextIn) {
        const hit = segLineIntersection(curr, next, n, m);
        if (hit) res.push(hit.point);
      } else if (!currIn && nextIn) {
        const hit = segLineIntersection(curr, next, n, m);
        if (hit) res.push(hit.point);
        res.push(next);
      }
    }
    return res;
  }
  function computeVoronoi(sites, bbox) {
    const basePoly = [
      { x: bbox.xl, y: bbox.yt },
      { x: bbox.xr, y: bbox.yt },
      { x: bbox.xr, y: bbox.yb },
      { x: bbox.xl, y: bbox.yb },
    ];
    const cells = {};
    const edgeMap = new Map();
    const keyPt = (p) => `${Math.round(p.x * 1000)}_${Math.round(p.y * 1000)}`;
    const keyEdge = (a, b) => {
      const ka = keyPt(a),
        kb = keyPt(b);
      return ka < kb ? ka + "|" + kb : kb + "|" + ka;
    };

    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      let poly = basePoly.slice();
      for (let j = 0; j < sites.length; j++) {
        if (i === j) continue;
        const t = sites[j];
        const n = sub(t, s);
        const m = mul(add(s, t), 0.5);
        poly = clipPolygonWithHalfPlane(poly, n, m);
        if (poly.length === 0) break;
      }
      cells[i] = { polygon: poly, site: s };
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        const kk = keyEdge(a, b);
        if (!edgeMap.has(kk)) edgeMap.set(kk, { a, b });
      }
    }
    return { cells, edges: Array.from(edgeMap.values()) };
  }

  // ---------- Shader‑style utilities ----------
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const fract = (x) => x - Math.floor(x);
  const mix = (a, b, t) => a * (1 - t) + b * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function hsl(h, s, l) {
    return `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;
  }
  function hash2(x, y) {
    return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
  }
  function noise2(x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const n00 = hash2(xi, yi),
      n10 = hash2(xi + 1, yi);
    const n01 = hash2(xi, yi + 1),
      n11 = hash2(xi + 1, yi + 1);
    const nx0 = mix(n00, n10, u),
      nx1 = mix(n01, n11, u);
    return mix(nx0, nx1, v);
  }
  function fbm(x, y, oct = 4) {
    let v = 0,
      a = 0.5,
      f = 1;
    for (let i = 0; i < oct; i++) {
      v += a * noise2(x * f, y * f);
      f *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  // ---------- UI refs ----------
  const canvas = document.getElementById("voronoiCanvas");
  const ctx = canvas.getContext("2d");
  const $ = (sel) => document.querySelector(sel);

  // Drawer controls
  const hamburger = $("#hamburger"),
    scrim = $("#scrim"),
    drawer = $("#controlsDrawer"),
    closeDrawerBtn = $("#closeDrawer");
  const randomBtn = $("#randomBtn"),
    clearBtn = $("#clearBtn"),
    edgesChk = $("#edgesChk"),
    sitesChk = $("#sitesChk");
  const highlightChk = $("#highlightChk"),
    glowChk = $("#glowChk"),
    shaderModeSel = $("#shaderMode"),
    animChk = $("#animChk");
  const hueRange = $("#hueRange"),
    hueVal = $("#hueVal"),
    spreadRange = $("#spreadRange"),
    spreadVal = $("#spreadVal");
  const satRange = $("#satRange"),
    satVal = $("#satVal"),
    lightRange = $("#lightRange"),
    lightVal = $("#lightVal");
  const scaleRange = $("#scaleRange"),
    scaleVal = $("#scaleVal"),
    speedRange = $("#speedRange"),
    speedVal = $("#speedVal");
  const edgeRange = $("#edgeRange"),
    edgeVal = $("#edgeVal"),
    siteRange = $("#siteRange"),
    siteVal = $("#siteVal");
  const runTestsBtn = $("#runTestsBtn"),
    relaxBtn = $("#relaxBtn"),
    relaxChk = $("#relaxChk");

  // --- State ---
  let diagram = null;
  let sites = [];
  let bbox = { xl: 0, xr: canvas.width, yt: 0, yb: canvas.height };
  let dpi = window.devicePixelRatio || 1;
  let needsRecompute = true;
  let isDragging = false;
  let draggedSiteIndex = -1;
  let t0 = performance.now();

  // Mouse-tracked site for highlighting (always at index 0)
  const mouseSite = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    isMouse: true,
  };
  sites.push(mouseSite);

  function syncIds() {
    for (let i = 0; i < sites.length; i++) sites[i].voronoiId = i;
  }

  // --- Drawer logic ---
  function openDrawer() {
    drawer.classList.add("open");
    scrim.classList.add("open");
    hamburger.setAttribute("aria-expanded", "true");
    closeDrawerBtn.setAttribute("aria-expanded", "true");
  }
  function closeDrawerFn() {
    drawer.classList.remove("open");
    scrim.classList.remove("open");
    hamburger.setAttribute("aria-expanded", "false");
    closeDrawerBtn.setAttribute("aria-expanded", "false");
  }
  hamburger.addEventListener("click", () => {
    drawer.classList.contains("open") ? closeDrawerFn() : openDrawer();
  });
  closeDrawerBtn.addEventListener("click", closeDrawerFn);
  scrim.addEventListener("click", closeDrawerFn);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open"))
      closeDrawerFn();
  });

  // --- Canvas sizing & DPI management ---
  function resizeCanvas() {
    // Get the responsive container element (we used .stage in the CSS)
    const container = document.querySelector(".stage");
    if (!container) return; // Exit if the container isn't found

    // Get its actual, on-screen size
    const rect = container.getBoundingClientRect();

    // Get the device pixel ratio for high-res screens
    dpi = window.devicePixelRatio || 1;

    // Set the canvas's internal drawing resolution to match the
    // on-screen size, multiplied by DPI.
    canvas.width = Math.floor(rect.width * dpi);
    canvas.height = Math.floor(rect.height * dpi);

    // NOTE: We no longer set canvas.style.width or canvas.style.height here.
    // The CSS is now fully in control of the layout.

    // Update your app's internal logic
    bbox = { xl: 0, xr: canvas.width, yt: 0, yb: canvas.height };
    needsRecompute = true;

    // It's a good idea to call your main drawing function here too,
    // so the canvas updates immediately after a resize.
  }

  // --- Make sure you call it! ---

  // Call it once on page load
  resizeCanvas();

  // And call it again whenever the window is resized
  window.addEventListener("resize", resizeCanvas);

  // --- Helpers ---
  function getMousePos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpi, y: (e.clientY - r.top) * dpi };
  }
  function polygonCentroid(poly) {
    let area = 0,
      cx = 0,
      cy = 0;
    if (!poly || poly.length < 3) return { x: 0, y: 0 };
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const cross = p1.x * p2.y - p2.x * p1.y;
      area += cross;
      cx += (p1.x + p2.x) * cross;
      cy += (p1.y + p2.y) * cross;
    }
    const sixArea = 3 * area;
    if (Math.abs(sixArea) < EPS) {
      // Fallback for tiny/degenerate polygons
      let fallbackX = 0,
        fallbackY = 0;
      for (const p of poly) {
        fallbackX += p.x;
        fallbackY += p.y;
      }
      return { x: fallbackX / poly.length, y: fallbackY / poly.length };
    }
    return { x: cx / sixArea, y: cy / sixArea };
  }

  function compute() {
    if (needsRecompute) {
      syncIds();
      diagram = computeVoronoi(sites, bbox);
      needsRecompute = false;
    }
  }
  function randomSitesFn(n = 50, clear = true) {
    const keepMouse = [sites[0]];
    sites = clear ? keepMouse : sites.slice();
    const margin = 20 * dpi;
    for (let i = 0; i < n; i++) {
      const x = margin + Math.random() * (canvas.width - 2 * margin);
      const y = margin + Math.random() * (canvas.height - 2 * margin);
      sites.push({ x, y });
    }
    needsRecompute = true;
  }
  function addSite(x, y) {
    sites.push({ x, y });
    needsRecompute = true;
  }
  function clearSitesFn() {
    sites = [sites[0]];
    needsRecompute = true;
  }
  function findSiteAt(pos, maxDist = 10 * dpi) {
    let closestIndex = -1;
    let minDSq = maxDist ** 2;
    for (let i = 1; i < sites.length; i++) {
      // Start at 1 to skip mouse site
      const dSq = distSq(pos, sites[i]);
      if (dSq < minDSq) {
        minDSq = dSq;
        closestIndex = i;
      }
    }
    return closestIndex;
  }

  // --- Lloyd's Relaxation ---
  function relaxSites() {
    if (!diagram) compute();
    let moved = false;
    for (let i = 1; i < sites.length; i++) {
      // Start at 1 to skip mouse site
      const cellInfo = diagram.cells[i];
      if (cellInfo && cellInfo.polygon && cellInfo.polygon.length > 0) {
        const centroid = polygonCentroid(cellInfo.polygon);
        if (isFinite(centroid.x) && isFinite(centroid.y)) {
          sites[i].x = centroid.x;
          sites[i].y = centroid.y;
          moved = true;
        }
      }
    }
    if (moved) needsRecompute = true;
  }

  // --- Rendering ---
  function drawPolygon(poly) {
    if (!poly || poly.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }

  function render() {
    const t = (performance.now() - t0) * 0.001 * parseFloat(speedRange.value);
    compute(); // Recomputes only if needsRecompute is true
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!diagram) return;

    // --- Get UI values ---
    const shaderMode = shaderModeSel.value;
    const baseHue = parseFloat(hueRange.value);
    const spread = parseFloat(spreadRange.value);
    const sat = parseFloat(satRange.value);
    const light = parseFloat(lightRange.value);
    const scale = parseFloat(scaleRange.value);
    const showEdges = edgesChk.checked;
    const showSites = sitesChk.checked;
    const showHighlight = highlightChk.checked;
    const showGlow = glowChk.checked;

    // --- Fill cells with shaders ---
    if (shaderMode !== "off") {
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
      for (const key in diagram.cells) {
        const cell = diagram.cells[key];
        const poly = cell.polygon;
        if (!poly || poly.length < 3) continue;
        const c = polygonCentroid(poly);
        let v = 0;
        if (shaderMode === "noise") {
          v = fbm(c.x / scale + t * 0.3, c.y / scale + t * 0.27, 4);
        } else if (shaderMode === "distance") {
          const d = Math.hypot(c.x - mouseSite.x, c.y - mouseSite.y);
          const maxD = Math.hypot(canvas.width, canvas.height);
          v = 1.0 - smoothstep(0, maxD * 0.7, d);
        } else if (shaderMode === "spiral") {
          const vec = sub(c, canvasCenter);
          const dist = Math.hypot(vec.x, vec.y) / (scale * 2);
          const angle = Math.atan2(vec.y, vec.x) / (Math.PI * 2);
          v = fract(dist - angle * 5.0 + t * 0.5);
        } else if (shaderMode === "cellId") {
          v = (cell.site.voronoiId % 11) / 11; // Use a prime number for better distribution
        }
        const hue = baseHue + v * spread;
        ctx.fillStyle = hsl(hue, sat, light);
        drawPolygon(poly);
        ctx.fill();
      }
    }

    // --- Draw edges ---
    if (showEdges) {
      ctx.beginPath();
      for (const e of diagram.edges) {
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
      }
      ctx.lineWidth = parseFloat(edgeRange.value) * dpi;
      ctx.strokeStyle = "#000000";
      if (showGlow) {
        ctx.shadowColor = hsl(baseHue, 100, 70);
        ctx.shadowBlur = 15 * dpi;
      }
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow for other elements
    }

    // --- Draw highlight cell ---
    if (showHighlight) {
      const cell = diagram.cells[mouseSite.voronoiId];
      if (cell && cell.polygon && cell.polygon.length > 2) {
        drawPolygon(cell.polygon);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fill();
      }
    }

    // --- Draw sites ---
    if (showSites) {
      ctx.beginPath();
      const r = parseFloat(siteRange.value) * dpi;
      for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        // Make dragged site or site under cursor bigger
        const radius =
          i === draggedSiteIndex || (i === findSiteAt(mouseSite) && !isDragging)
            ? r * 1.8
            : r;
        if (radius > 0) {
          ctx.moveTo(s.x + radius, s.y);
          ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = hsl(baseHue - 180, 80, 50);
      ctx.fill();
    }
  }

  // --- Animation loop ---
  function animate() {
    if (relaxChk.checked) {
      relaxSites();
    }
    if (animChk.checked || needsRecompute || isDragging) {
      render();
    }
    requestAnimationFrame(animate);
  }

  // --- Events ---
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // Only left-click
    const m = getMousePos(e);
    const siteIdx = findSiteAt(m);
    if (siteIdx !== -1) {
      isDragging = true;
      draggedSiteIndex = siteIdx;
    } else {
      addSite(m.x, m.y);
    }
    needsRecompute = true;
  });
  canvas.addEventListener("mousemove", (e) => {
    const m = getMousePos(e);
    mouseSite.x = m.x;
    mouseSite.y = m.y;
    if (isDragging && draggedSiteIndex !== -1) {
      sites[draggedSiteIndex].x = m.x;
      sites[draggedSiteIndex].y = m.y;
    }
    needsRecompute = true;
  });
  canvas.addEventListener("mouseup", (e) => {
    isDragging = false;
    draggedSiteIndex = -1;
    needsRecompute = true;
  });
  canvas.addEventListener("mouseleave", (e) => {
    isDragging = false;
    draggedSiteIndex = -1;
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const m = getMousePos(e);
    const siteIdx = findSiteAt(m);
    if (siteIdx !== -1) {
      sites.splice(siteIdx, 1);
      needsRecompute = true;
    }
  });

  window.addEventListener("resize", resizeCanvas);
  randomBtn?.addEventListener("click", () => {
    randomSitesFn(50, true);
  });
  clearBtn?.addEventListener("click", () => {
    clearSitesFn();
  });
  relaxBtn?.addEventListener("click", () => {
    relaxSites();
    needsRecompute = true;
  });

  // Slider bindings
  function bindRange(range, label, fmt) {
    if (!range) return;
    const update = () => {
      label.textContent = fmt(range.value);
    };
    range.addEventListener("input", update);
    update();
  }
  bindRange(hueRange, hueVal, (v) => `${v}°`);
  bindRange(spreadRange, spreadVal, (v) => `${v}°`);
  bindRange(satRange, satVal, (v) => `${v}%`);
  bindRange(lightRange, lightVal, (v) => `${v}%`);
  bindRange(scaleRange, scaleVal, (v) => `${v}`);
  bindRange(speedRange, speedVal, (v) => `${parseFloat(v).toFixed(2)}`);
  bindRange(edgeRange, edgeVal, (v) => `${parseFloat(v).toFixed(1)}`);
  bindRange(siteRange, siteVal, (v) => `${parseFloat(v).toFixed(1)}`);

  // --- Tests ---
  function runTests() {
    const out = [];
    function pass(msg) {
      out.push(`<div class=\"test-pass\">✔ ${msg}</div>`);
    }
    function fail(msg) {
      out.push(`<div class=\"test-fail\">✘ ${msg}</div>`);
    }
    function approxEq(a, b, eps = 1e-6) {
      return Math.abs(a - b) <= eps;
    }

    // Centroid test
    (function () {
      const poly = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const c = polygonCentroid(poly);
      const ok = approxEq(c.x, 5) && approxEq(c.y, 5);
      ok
        ? pass("Centroid of square is correct")
        : fail("Centroid of square failed");
    })();
    (function () {
      const poly = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ];
      const c = polygonCentroid(poly);
      const ok = approxEq(c.x, 5) && approxEq(c.y, 10 / 3);
      ok
        ? pass("Centroid of triangle is correct")
        : fail("Centroid of triangle failed");
    })();

    // Original tests
    (function () {
      const bbox = { xl: 0, xr: 100, yt: 0, yb: 100 };
      const sites = [{ x: 50, y: 50 }];
      const d = computeVoronoi(sites, bbox);
      const poly = d.cells[0].polygon;
      const ok =
        poly &&
        poly.length === 4 &&
        poly.every((p) => p.x === 0 || p.x === 100 || p.y === 0 || p.y === 100);
      ok
        ? pass("Single site cell equals bounding box")
        : fail("Single site did not equal bbox");
    })();
    (function () {
      const bbox = { xl: 0, xr: 100, yt: 0, yb: 100 };
      const s0 = { x: 25, y: 50 },
        s1 = { x: 75, y: 50 };
      const d = computeVoronoi([s0, s1], bbox);
      const poly0 = d.cells[0].polygon;
      const maxX = Math.max(...poly0.map((p) => p.x));
      const ok = maxX <= 50 + 1e-4;
      ok
        ? pass("Two sites: left cell limited to x ≤ 50 (vertical bisector)")
        : fail(`Two sites: left cell max x ${maxX} > 50`);
    })();
    (function () {
      const a = noise2(10.25, 99.5),
        b = noise2(10.25, 99.5);
      approxEq(a, b, 1e-12)
        ? pass("noise2 deterministic for same input")
        : fail("noise2 differs for same input");
    })();

    document.getElementById("testsOutput").innerHTML = out.join("");
    document.getElementById("testsPanel").open = true;
  }
  runTestsBtn?.addEventListener("click", runTests);

  // --- Boot ---
  resizeCanvas();
  randomSitesFn(30, false);
  animate();
})();
