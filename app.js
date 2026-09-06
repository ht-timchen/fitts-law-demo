(() => {
  "use strict";

  const MODES = {
    easy: { wMin: 64, wMax: 88, idMin: 1.0, idMax: 2.5 },
    medium: { wMin: 44, wMax: 68, idMin: 2.5, idMax: 4.0 },
    hard: { wMin: 28, wMax: 48, idMin: 4.0, idMax: 5.5 },
    mixed: { wMin: 28, wMax: 88, idMin: 1.0, idMax: 5.5 },
  };

  const BANDS = ["easy", "medium", "hard"];
  const CSV_COLUMNS = [
    "trial",
    "movement_time_ms",
    "distance_px",
    "width_px",
    "id_bits",
    "errors",
    "pointer_type",
    "difficulty",
    "target_x",
    "target_y",
    "viewport_width",
    "viewport_height",
    "completed_at_iso",
    "accessibility_input",
  ];
  const CHART_POINT_CAP = 500;
  const MIN_MT_MS = 40;
  const MAX_MT_MS = 60000;
  const CANDIDATE_TRIES = 50;
  const SAFE_PAD = 8;
  const MIN_SEPARATION = 24;

  const els = {
    area: document.getElementById("experiment"),
    target: document.getElementById("target"),
    flash: document.getElementById("hit-flash"),
    live: document.getElementById("status-live"),
    latest: document.getElementById("stat-latest"),
    id: document.getElementById("stat-id"),
    trials: document.getElementById("stat-trials"),
    average: document.getElementById("stat-average"),
    accuracy: document.getElementById("stat-accuracy"),
    chart: document.getElementById("chart"),
    equation: document.getElementById("equation"),
    intercept: document.getElementById("stat-intercept"),
    slope: document.getElementById("stat-slope"),
    summary: document.getElementById("chart-summary"),
    reset: document.getElementById("reset-btn"),
    download: document.getElementById("download-btn"),
    csvHint: document.getElementById("csv-hint"),
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");

  const state = {
    trials: [],
    sessionMisses: 0,
    difficulty: "mixed",
    warmupComplete: false,
    previousCenter: null,
    current: null,
    startedAt: 0,
    completing: false,
    invalidated: false,
    bandQueue: [],
    currentErrors: 0,
  };

  let resizeTimer = 0;
  let missTimer = 0;
  let flashTimer = 0;

  function shuffle(items) {
    const list = items.slice();
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function round2(value) {
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function niceStep(max, targetCount) {
    const raw = Math.max(max, 1) / targetCount;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    if (norm >= 5) return 5 * mag;
    if (norm >= 2) return 2 * mag;
    return mag;
  }

  function nextBand() {
    if (state.bandQueue.length === 0) {
      state.bandQueue = shuffle(BANDS.concat(BANDS));
    }
    return state.bandQueue.shift();
  }

  function isCoarsePointer() {
    return coarsePointer.matches;
  }

  function announce(message) {
    els.live.textContent = "";
    window.requestAnimationFrame(() => {
      els.live.textContent = message;
    });
  }

  function fitWidth(range, areaW, areaH) {
    const maxFit = Math.max(16, Math.min(range.wMax, areaW - SAFE_PAD * 2, areaH - SAFE_PAD * 2));
    let minW = Math.min(range.wMin, maxFit);
    if (isCoarsePointer() && maxFit >= 36) {
      minW = Math.max(minW, 36);
      if (minW > maxFit) minW = maxFit;
    }
    if (minW > maxFit) minW = maxFit;
    return rand(minW, maxFit);
  }

  function maxReach(prev, minX, maxX, minY, maxY) {
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY },
    ];
    return corners.reduce((best, point) => {
      const d = Math.hypot(point.x - prev.x, point.y - prev.y);
      return d > best.d ? { point, d } : best;
    }, { point: corners[0], d: -1 });
  }

  function generateCandidate(areaW, areaH, prevCenter, warmup) {
    const modeKey = state.difficulty === "mixed" && !warmup ? nextBand() : state.difficulty;
    const range = MODES[modeKey] || MODES.mixed;
    const w = fitWidth(range, areaW, areaH);
    const radius = w / 2;
    const inset = radius + SAFE_PAD;
    let minX = inset;
    let maxX = areaW - inset;
    let minY = inset;
    let maxY = areaH - inset;

    if (maxX < minX) {
      minX = areaW / 2;
      maxX = minX;
    }
    if (maxY < minY) {
      minY = areaH / 2;
      maxY = minY;
    }

    if (!prevCenter || warmup) {
      return {
        x: rand(minX, maxX),
        y: rand(minY, maxY),
        w,
      };
    }

    const minD = Math.max(40, 1.25 * w);
    const farthest = maxReach(prevCenter, minX, maxX, minY, maxY);
    const usableMinD = Math.min(minD, Math.max(1, farthest.d * 0.85));
    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < CANDIDATE_TRIES; i += 1) {
      const x = rand(minX, maxX);
      const y = rand(minY, maxY);
      const d = Math.hypot(x - prevCenter.x, y - prevCenter.y);
      if (d < usableMinD) continue;
      if (d < MIN_SEPARATION) continue;
      const id = Math.log2(d / w + 1);
      if (!Number.isFinite(id)) continue;
      const score =
        id < range.idMin ? range.idMin - id : id > range.idMax ? id - range.idMax : 0;
      if (score === 0) {
        return { x, y, w };
      }
      if (score < bestScore) {
        bestScore = score;
        best = { x, y, w };
      }
    }

    return best || { x: farthest.point.x, y: farthest.point.y, w };
  }

  function measureTarget() {
    const areaRect = els.area.getBoundingClientRect();
    const targetRect = els.target.getBoundingClientRect();
    if (areaRect.width < 8 || areaRect.height < 8 || targetRect.width < 1) {
      return null;
    }
    return {
      x: targetRect.left + targetRect.width / 2 - areaRect.left,
      y: targetRect.top + targetRect.height / 2 - areaRect.top,
      w: targetRect.width,
    };
  }

  function applyTarget(spec) {
    els.target.style.width = `${spec.w}px`;
    els.target.style.height = `${spec.w}px`;
    els.target.style.left = `${spec.x}px`;
    els.target.style.top = `${spec.y}px`;
    els.target.classList.add("is-ready");
  }

  function keepTargetInBounds() {
    const geo = measureTarget();
    if (!geo) return false;
    const areaW = els.area.clientWidth;
    const areaH = els.area.clientHeight;
    const radius = geo.w / 2;
    const inset = radius + SAFE_PAD;
    const x = Math.min(Math.max(geo.x, inset), Math.max(inset, areaW - inset));
    const y = Math.min(Math.max(geo.y, inset), Math.max(inset, areaH - inset));
    const moved = Math.hypot(x - geo.x, y - geo.y) > 0.5;
    if (moved) applyTarget({ x, y, w: geo.w });
    return moved;
  }

  function commitStart() {
    const geo = measureTarget();
    if (!geo || !Number.isFinite(geo.w) || geo.w <= 0) {
      window.requestAnimationFrame(() => placeTarget(false));
      return;
    }

    let distance = 0;
    let id = 0;
    if (state.warmupComplete && state.previousCenter) {
      distance = Math.hypot(geo.x - state.previousCenter.x, geo.y - state.previousCenter.y);
      id = Math.log2(distance / geo.w + 1);
      if (!Number.isFinite(id) || distance <= 0) {
        window.requestAnimationFrame(() => placeTarget(false));
        return;
      }
    }

    state.current = { x: geo.x, y: geo.y, w: geo.w, distance, id };
    state.startedAt = performance.now();
    state.completing = false;
    state.invalidated = false;
    renderStats();
  }

  function placeTarget(warmup) {
    const areaW = els.area.clientWidth;
    const areaH = els.area.clientHeight;
    if (areaW < 32 || areaH < 32) return;

    const spec = generateCandidate(areaW, areaH, state.previousCenter, warmup);
    applyTarget(spec);
    window.requestAnimationFrame(commitStart);
  }

  function scheduleNext(warmup) {
    window.requestAnimationFrame(() => {
      placeTarget(warmup);
    });
  }

  function showHitFeedback(x, y) {
    els.flash.style.left = `${x}px`;
    els.flash.style.top = `${y}px`;
    els.flash.classList.remove("is-on");
    void els.flash.offsetWidth;
    if (reduceMotion.matches) {
      els.area.classList.add("is-hit-static");
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        els.area.classList.remove("is-hit-static");
      }, 120);
      return;
    }
    els.flash.classList.add("is-on");
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      els.flash.classList.remove("is-on");
    }, 160);
  }

  function showMissFeedback() {
    els.area.classList.add("is-miss");
    window.clearTimeout(missTimer);
    missTimer = window.setTimeout(() => {
      els.area.classList.remove("is-miss");
    }, 140);
  }

  function pointerKind(event) {
    const type = event && event.pointerType;
    if (type === "mouse" || type === "touch" || type === "pen") return type;
    return "unknown";
  }

  function fitRegression(trials) {
    if (trials.length < 5) return null;
    const ids = trials.map((trial) => trial.indexOfDifficultyBits);
    const mts = trials.map((trial) => trial.movementTimeMs);
    const idExtent = Math.max(...ids) - Math.min(...ids);
    if (!(idExtent > 1e-9)) return null;

    const meanID = mean(ids);
    const meanMT = mean(mts);
    let num = 0;
    let den = 0;
    for (let i = 0; i < trials.length; i += 1) {
      const di = ids[i] - meanID;
      num += di * (mts[i] - meanMT);
      den += di * di;
    }
    if (!(den > 0) || !Number.isFinite(den)) return null;

    const b = num / den;
    const a = meanMT - b * meanID;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < trials.length; i += 1) {
      const predicted = a + b * ids[i];
      ssRes += (mts[i] - predicted) ** 2;
      ssTot += (mts[i] - meanMT) ** 2;
    }
    if (!(ssTot > 0) || !Number.isFinite(ssTot)) return null;
    const r2 = 1 - ssRes / ssTot;
    if (![a, b, r2].every(Number.isFinite)) return null;
    return { a, b, r2, minID: Math.min(...ids), maxID: Math.max(...ids) };
  }

  function formatEquation(fit) {
    const a = Math.round(fit.a);
    const b = Math.round(fit.b);
    const sign = b < 0 ? "−" : "+";
    return `MT = ${a} ${sign} ${Math.abs(b)} × ID, R² = ${fit.r2.toFixed(2)}`;
  }

  function renderStats() {
    const trials = state.trials;
    els.trials.textContent = String(trials.length);

    if (trials.length === 0) {
      els.latest.textContent = "—";
      els.average.textContent = "—";
    } else {
      const latest = trials[trials.length - 1].movementTimeMs;
      const avg = mean(trials.map((trial) => trial.movementTimeMs));
      els.latest.textContent = `${Math.round(latest)} ms`;
      els.average.textContent = `${Math.round(avg)} ms`;
    }

    if (!state.warmupComplete) {
      els.id.textContent = "Warm-up";
    } else if (state.current && state.current.distance > 0 && Number.isFinite(state.current.id)) {
      els.id.textContent = `${state.current.id.toFixed(2)} bits`;
    } else {
      els.id.textContent = "—";
    }

    const hits = trials.length;
    const misses = state.sessionMisses;
    if (hits + misses === 0) {
      els.accuracy.textContent = "—";
    } else {
      els.accuracy.textContent = `${Math.round((hits / (hits + misses)) * 100)}%`;
    }
  }

  function renderChart() {
    const trials = state.trials;
    const display = trials.slice(-CHART_POINT_CAP);
    const fit = fitRegression(trials);
    const width = 600;
    const height = 280;
    const pad = { l: 56, r: 16, t: 18, b: 44 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const ids = display.map((trial) => trial.indexOfDifficultyBits);
    const mts = display.map((trial) => trial.movementTimeMs);
    const xMin = 0;
    const xMax = Math.max(6, ...(ids.length ? ids : [0]));
    const yMaxRaw = mts.length ? Math.max(...mts) * 1.12 : 1000;
    const yStep = niceStep(Math.max(100, yMaxRaw), 4);
    const yMax = Math.max(yStep, Math.ceil(yMaxRaw / yStep) * yStep);

    const xOf = (id) => pad.l + ((id - xMin) / (xMax - xMin)) * plotW;
    const yOf = (mt) => pad.t + (1 - mt / yMax) * plotH;

    const xTicks = [];
    for (let id = 0; id <= xMax + 0.001; id += 1) xTicks.push(id);
    const yTicks = [];
    for (let mt = 0; mt <= yMax + 0.001; mt += yStep) yTicks.push(mt);

    let svg = "";
    svg += `<defs><clipPath id="plot-clip"><rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}"/></clipPath></defs>`;
    svg += `<rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="#fffdf8" stroke="#d9d1c0"/>`;
    xTicks.forEach((tick) => {
      const x = xOf(tick);
      svg += `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + plotH}" stroke="#eee8da"/>`;
      svg += `<text x="${x}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#5e584c">${tick}</text>`;
    });
    yTicks.forEach((tick) => {
      const y = yOf(tick);
      svg += `<line x1="${pad.l}" y1="${y}" x2="${pad.l + plotW}" y2="${y}" stroke="#eee8da"/>`;
      svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#5e584c">${tick}</text>`;
    });
    svg += `<text x="${pad.l + plotW / 2}" y="${height - 2}" text-anchor="middle" font-size="12" fill="#16140f">Index of Difficulty (bits)</text>`;
    svg += `<text x="12" y="${pad.t + plotH / 2}" text-anchor="middle" font-size="12" fill="#16140f" transform="rotate(-90 12 ${pad.t + plotH / 2})">Movement Time (ms)</text>`;

    svg += `<g clip-path="url(#plot-clip)">`;
    display.forEach((trial) => {
      svg += `<circle cx="${xOf(trial.indexOfDifficultyBits)}" cy="${yOf(trial.movementTimeMs)}" r="4" fill="#c2410c" fill-opacity="0.82"/>`;
    });

    if (fit) {
      const x1 = xOf(fit.minID);
      const y1 = yOf(fit.a + fit.b * fit.minID);
      const x2 = xOf(fit.maxID);
      const y2 = yOf(fit.a + fit.b * fit.maxID);
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0b6e5b" stroke-width="2"/>`;
    }
    svg += `</g>`;

    els.chart.innerHTML = svg;

    if (fit) {
      els.equation.textContent = formatEquation(fit);
      els.intercept.textContent = `${Math.round(fit.a)} ms`;
      const slope = Math.round(fit.b);
      els.slope.textContent = `${slope < 0 ? "−" : ""}${Math.abs(slope)} ms/bit`;
    } else {
      els.equation.textContent = "Complete 5 varied trials to see your trend.";
      els.intercept.textContent = "—";
      els.slope.textContent = "—";
    }

    if (trials.length === 0) {
      els.summary.textContent =
        "Scatterplot of movement time against index of difficulty. No measured trials yet.";
    } else {
      const last = trials[trials.length - 1];
      const trialWord = trials.length === 1 ? "trial" : "trials";
      let text = `Scatterplot of movement time against index of difficulty. ${trials.length} measured ${trialWord}. Latest ${Math.round(last.movementTimeMs)} ms at ${last.indexOfDifficultyBits.toFixed(2)} bits.`;
      if (fit) {
        text += ` Trend: ${formatEquation(fit)}. Intercept ${Math.round(fit.a)} ms, slope ${Math.round(fit.b)} ms/bit.`;
      }
      els.summary.textContent = text;
    }
  }

  function updateCsvControl() {
    const enabled = state.trials.length > 0;
    els.download.disabled = !enabled;
    els.csvHint.textContent = enabled
      ? "Downloads the current session as a CSV file."
      : "Available after the first measured trial.";
  }

  function renderAll() {
    renderStats();
    renderChart();
    updateCsvControl();
  }

  function toCsv(trials) {
    const header = CSV_COLUMNS.join(",");
    const rows = trials.map((trial) =>
      [
        trial.trial,
        round2(trial.movementTimeMs),
        round2(trial.distancePx),
        round2(trial.widthPx),
        round2(trial.indexOfDifficultyBits),
        trial.errors,
        trial.pointerType,
        trial.difficulty,
        round2(trial.targetX),
        round2(trial.targetY),
        trial.viewportWidth,
        trial.viewportHeight,
        trial.completedAtIso,
        trial.accessibilityInput,
      ].join(",")
    );
    return `${header}\n${rows.join("\n")}\n`;
  }

  function completeTrial(event, accessibilityInput) {
    if (state.completing || !state.current) return;

    if (state.warmupComplete) {
      const previewMt = performance.now() - state.startedAt;
      if (previewMt < MIN_MT_MS || previewMt > MAX_MT_MS) {
        state.startedAt = performance.now();
        announce("Trial restarted.");
        return;
      }
    }

    state.completing = true;

    const hitX = state.current.x;
    const hitY = state.current.y;
    showHitFeedback(hitX, hitY);

    if (!state.warmupComplete) {
      state.warmupComplete = true;
      state.previousCenter = { x: hitX, y: hitY };
      state.currentErrors = 0;
      announce("Warm-up complete. Trials will be recorded.");
      scheduleNext(false);
      return;
    }

    const endedAt = performance.now();
    const movementTimeMs = endedAt - state.startedAt;
    const geo = measureTarget() || state.current;
    const distancePx = state.previousCenter
      ? Math.hypot(geo.x - state.previousCenter.x, geo.y - state.previousCenter.y)
      : state.current.distance;
    const widthPx = geo.w;
    const indexOfDifficultyBits = Math.log2(distancePx / widthPx + 1);
    if (!Number.isFinite(indexOfDifficultyBits) || !Number.isFinite(movementTimeMs)) {
      announce("Trial restarted.");
      scheduleNext(false);
      return;
    }

    const trial = {
      trial: state.trials.length + 1,
      startedAt: state.startedAt,
      endedAt,
      movementTimeMs,
      distancePx,
      widthPx,
      indexOfDifficultyBits,
      errors: state.currentErrors,
      pointerType: accessibilityInput ? "keyboard" : pointerKind(event),
      difficulty: state.difficulty,
      targetX: geo.x,
      targetY: geo.y,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      completedAtIso: new Date().toISOString(),
      accessibilityInput: Boolean(accessibilityInput),
    };

    state.trials.push(trial);
    state.previousCenter = { x: geo.x, y: geo.y };
    state.currentErrors = 0;
    renderAll();
    announce(`Trial ${trial.trial}, ${Math.round(movementTimeMs)} milliseconds.`);
    scheduleNext(false);
  }

  function registerMiss() {
    if (state.completing || !state.current) return;
    if (!state.warmupComplete) return;
    state.currentErrors += 1;
    state.sessionMisses += 1;
    showMissFeedback();
    renderStats();
  }

  function isCircularHit(event) {
    const geo = measureTarget();
    if (!geo) return false;
    const areaRect = els.area.getBoundingClientRect();
    const dx = event.clientX - (areaRect.left + geo.x);
    const dy = event.clientY - (areaRect.top + geo.y);
    return dx * dx + dy * dy <= (geo.w / 2) * (geo.w / 2);
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    if (isCircularHit(event)) {
      completeTrial(event, false);
    } else {
      registerMiss();
    }
  }

  function onTargetKey(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.repeat) return;
    event.preventDefault();
    completeTrial(event, true);
  }

  function restartActiveTrial(message) {
    if (!state.current) {
      placeTarget(!state.warmupComplete);
      return;
    }
    state.startedAt = performance.now();
    state.invalidated = false;
    if (state.warmupComplete && state.previousCenter) {
      const geo = measureTarget();
      if (geo) {
        state.current = {
          x: geo.x,
          y: geo.y,
          w: geo.w,
          distance: Math.hypot(geo.x - state.previousCenter.x, geo.y - state.previousCenter.y),
          id: Math.log2(
            Math.hypot(geo.x - state.previousCenter.x, geo.y - state.previousCenter.y) / geo.w + 1
          ),
        };
      }
    }
    renderStats();
    if (message) announce(message);
  }

  function onResize() {
    if (state.completing) {
      renderChart();
      return;
    }
    if (els.area.clientWidth < 32) return;
    if (!state.current) {
      placeTarget(!state.warmupComplete);
      renderChart();
      return;
    }
    const moved = keepTargetInBounds();
    if (moved) restartActiveTrial("Trial restarted.");
    renderChart();
  }

  function resetSession() {
    state.trials = [];
    state.sessionMisses = 0;
    state.warmupComplete = false;
    state.previousCenter = null;
    state.current = null;
    state.startedAt = 0;
    state.completing = false;
    state.invalidated = false;
    state.bandQueue = [];
    state.currentErrors = 0;
    renderAll();
    announce("Session reset. Warm-up target ready.");
    placeTarget(true);
  }

  function downloadCsv() {
    if (state.trials.length === 0) return;
    const blob = new Blob([toCsv(state.trials)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fitts-law-trials.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bind() {
    els.area.addEventListener("pointerdown", onPointerDown);
    els.area.addEventListener("click", (event) => event.preventDefault());
    els.target.addEventListener("keydown", onTargetKey);
    els.reset.addEventListener("click", resetSession);
    els.download.addEventListener("click", downloadCsv);

    document.querySelectorAll('input[name="difficulty"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        state.difficulty = input.value;
        state.currentErrors = 0;
        state.completing = false;
        if (state.warmupComplete && state.current) {
          state.previousCenter = { x: state.current.x, y: state.current.y };
        }
        announce(`Difficulty set to ${state.difficulty}. Trial restarted.`);
        if (state.warmupComplete) {
          placeTarget(false);
        } else {
          placeTarget(true);
        }
      });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        state.invalidated = true;
        return;
      }
      if (state.invalidated) restartActiveTrial("Trial restarted.");
    });

    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(onResize, 100);
    });
    window.addEventListener("orientationchange", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(onResize, 100);
    });

    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(onResize, 100);
    });
    observer.observe(els.area);
  }

  function init() {
    bind();
    renderAll();
    placeTarget(true);
  }

  init();
})();
