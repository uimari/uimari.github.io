(() => {
  "use strict";

  const API_BASE = "https://api.sensoripaja.fi";
  const REGIONS = [
    { id: "swimhelsinki", label: "Helsinki" },
    { id: "swimespoo", label: "Espoo" },
  ];

  const DAY_MS = 24 * 3600 * 1000;
  const RANGE_CONFIG = {
    week: { short: "1W", label: "7 days", ms: 7 * DAY_MS, ticks: 7 },
    month: { short: "1M", label: "30 days", ms: 30 * DAY_MS, ticks: 6 },
    "3m": { short: "3M", label: "3 months", ms: 90 * DAY_MS, ticks: 6 },
    "6m": { short: "6M", label: "6 months", ms: 180 * DAY_MS, ticks: 6 },
    ytd: { short: "YTD", label: "Year to date", ms: null, ticks: 6 },
    "1y": { short: "1Y", label: "1 year", ms: 365 * DAY_MS, ticks: 6 },
    "2y": { short: "2Y", label: "2 years", ms: 730 * DAY_MS, ticks: 6 },
    all: { short: "All", label: "All time", ms: null, ticks: 6 },
  };

  // Application State
  const state = {
    stations: [], // Array of normalized station objects
    stationByKey: new Map(),
    view: "charts", // 'charts' | 'map'
    range: "week", // 'week' | 'month' | '3m' | '6m' | 'ytd' | '1y' | '2y' | 'all'
    region: "all", // 'all' | 'swimhelsinki' | 'swimespoo'
    search: "",
    sort: "name", // 'name' | 'temp-desc' | 'temp-asc' | 'updated'
    layout: "stack", // 'stack' | 'grid'
    hideWinterStorage: true,
    overviewCollapsed: false,
    focusedStationKey: null, // Click legend chip to isolate/highlight a sensor
    hoveredStationKey: null, // Hover legend chip to highlight a sensor
    referenceNowMs: Date.now(),
    earliestGlobalMs: Date.now() - 365 * DAY_MS,
    loadedHistories: 0,
    totalStations: 0,
    mapInstance: null,
    mapTileLayer: null,
    mapMarkersLayer: null,
    mapTheme: null,
  };

  // DOM Elements
  const el = {
    liveIndicator: document.getElementById("live-indicator"),
    statusSummary: document.getElementById("status-summary"),
    loadingFill: document.getElementById("loading-fill"),
    countAll: document.getElementById("count-all"),
    countHelsinki: document.getElementById("count-swimhelsinki"),
    countEspoo: document.getElementById("count-swimespoo"),
    viewTabs: document.getElementById("view-tabs"),
    chartsView: document.getElementById("charts-view"),
    mapView: document.getElementById("map-view"),
    stationsMap: document.getElementById("stations-map"),
    mapCaption: document.getElementById("map-caption"),
    mapHideStorageToggle: document.getElementById("map-hide-storage-toggle"),
    cwMinVal: document.getElementById("cw-min-val"),
    cwMidVal: document.getElementById("cw-mid-val"),
    cwMaxVal: document.getElementById("cw-max-val"),
    regionPicker: document.getElementById("region-picker"),
    rangePicker: document.getElementById("range-picker"),
    layoutPicker: document.getElementById("layout-picker"),
    stationSearch: document.getElementById("station-search"),
    sortSelect: document.getElementById("sort-select"),
    refreshBtn: document.getElementById("refresh-btn"),
    themeBtn: document.getElementById("theme-btn"),
    overviewBody: document.getElementById("overview-body"),
    overviewCanvas: document.getElementById("overview-canvas"),
    overviewTooltip: document.getElementById("overview-tooltip"),
    overviewCaption: document.getElementById("overview-caption"),
    resetHighlightBtn: document.getElementById("reset-highlight-btn"),
    toggleOverviewBtn: document.getElementById("toggle-overview-btn"),
    sensorLegend: document.getElementById("sensor-legend"),
    stationsCountLabel: document.getElementById("stations-count-label"),
    hideStorageToggle: document.getElementById("hide-storage-toggle"),
    errorBanner: document.getElementById("error-banner"),
    stationsList: document.getElementById("stations-list"),
    lastSyncLabel: document.getElementById("last-sync-label"),
  };

  // Coolwarm diverging colormap (Blue -> Neutral -> Red)
  const COOLWARM_STOPS = [
    [0.0, [59, 76, 192]],
    [0.25, [112, 146, 243]],
    [0.5, [221, 221, 221]],
    [0.75, [243, 148, 117]],
    [1.0, [180, 4, 38]],
  ];

  function coolwarmColor(value, minVal, maxVal) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return { bg: "rgb(100, 116, 139)", fg: "#ffffff" };
    }
    const span = maxVal - minVal;
    const t = span > 1e-6 ? Math.max(0, Math.min(1, (value - minVal) / span)) : 0.5;

    let rgb = COOLWARM_STOPS[COOLWARM_STOPS.length - 1][1];
    for (let i = 0; i < COOLWARM_STOPS.length - 1; i++) {
      const [t0, c0] = COOLWARM_STOPS[i];
      const [t1, c1] = COOLWARM_STOPS[i + 1];
      if (t >= t0 && t <= t1) {
        const u = (t - t0) / (t1 - t0);
        rgb = [
          Math.round(c0[0] + u * (c1[0] - c0[0])),
          Math.round(c0[1] + u * (c1[1] - c0[1])),
          Math.round(c0[2] + u * (c1[2] - c0[2])),
        ];
        break;
      }
    }

    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    const fg = lum > 0.62 ? "#0f172a" : "#ffffff";
    return {
      bg: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
      fg,
    };
  }

  // Generate unique, perceptually distinct colors for N sensors using golden-angle hue stepping
  function assignUniqueColor(index, isDark = false) {
    const goldenAngle = 137.50776405;
    const hue = Math.round((index * goldenAngle + 195) % 360);
    const satLevels = [76, 66, 82];
    const lightLevelsLight = [42, 48, 37];
    const lightLevelsDark = [62, 68, 56];
    const sat = satLevels[index % satLevels.length];
    const light = (isDark ? lightLevelsDark : lightLevelsLight)[index % 3];
    return {
      hue,
      sat,
      lightLight: lightLevelsLight[index % 3],
      lightDark: lightLevelsDark[index % 3],
      css(dark) {
        const l = dark ? this.lightDark : this.lightLight;
        return `hsl(${this.hue} ${this.sat}% ${l}%)`;
      },
      alpha(dark, a) {
        const l = dark ? this.lightDark : this.lightLight;
        return `hsla(${this.hue}, ${this.sat}%, ${l}%, ${a})`;
      },
    };
  }

  function isDarkTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  // Formatting utilities
  function formatTemp(val) {
    if (val === null || val === undefined || Number.isNaN(val)) return "–";
    return `${Number(val).toFixed(2)} °C`;
  }

  function formatTempShort(val) {
    if (val === null || val === undefined || Number.isNaN(val)) return "–";
    return `${Number(val).toFixed(1)}°`;
  }

  function formatDateTime(ms) {
    if (!ms) return "–";
    const d = new Date(ms);
    return d.toLocaleString("fi-FI", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatAxisTick(ms, rangeKey, spanMs = 0) {
    const d = new Date(ms);
    if (rangeKey === "week") {
      return d.toLocaleDateString("fi-FI", { weekday: "short", day: "numeric", month: "numeric" });
    }
    if (spanMs > 190 * DAY_MS || rangeKey === "1y" || rangeKey === "2y" || rangeKey === "all") {
      return d.toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "2-digit" });
    }
    return d.toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" });
  }

  function formatRelativeAge(ms, refNowMs) {
    if (!ms) return "";
    const diffMin = Math.round((refNowMs - ms) / 60000);
    if (diffMin <= 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 48) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d ago`;
  }

  // Normalize feature from featurecollection.geojson
  function normalizeFeature(feature, regionObj, globalIndex) {
    const props = feature.properties || {};
    const name = (props.name || props.location || feature.id || `Station ${globalIndex + 1}`).trim();
    const key = `${regionObj.id}:${name}`;
    const meas = props.measurement || {};
    const latestMs = meas.time ? Date.parse(meas.time) : null;
    const latestTemp = typeof meas.temp_water === "number" ? meas.temp_water : null;
    const battmV = typeof meas.battmV === "number" ? meas.battmV : null;

    const depth =
      props.installation_depth !== undefined
        ? props.installation_depth
        : props["installation depth"];
    const platform =
      props.installation_platform || props["installation platform"] || "";
    const info = (props.info || "").trim();
    const inWinterStorage = /talvisäilyty/i.test(info);

    const coords = feature.geometry?.coordinates;
    const lon = Array.isArray(coords) && typeof coords[0] === "number" ? coords[0] : null;
    const lat = Array.isArray(coords) && typeof coords[1] === "number" ? coords[1] : null;

    return {
      key,
      id: feature.id || name,
      name,
      regionId: regionObj.id,
      regionLabel: regionObj.label,
      colorSpec: assignUniqueColor(globalIndex),
      lat,
      lon,
      latestMs,
      latestTemp,
      battmV,
      depth,
      platform,
      info,
      inWinterStorage,
      geojsonUrl: `${API_BASE}/${regionObj.id}/${encodeURIComponent(name + ".geojson")}`,
      points: [], // [{ t: ms, temp: number, batt: number }] sorted ascending by t
      historyLoaded: false,
      historyError: null,
      dom: null, // cached card DOM references
    };
  }

  // Parse full telemetry history from station GeoJSON, sorted ascending and deduplicated
  function parseStationGeojson(data) {
    const raw = data?.properties?.data?.raw;
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const parsed = [];
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item || typeof item.temp_water !== "number" || !item.time) continue;
      const t = Date.parse(item.time);
      if (!Number.isNaN(t)) {
        parsed.push({
          t,
          temp: item.temp_water,
          batt: typeof item.battmV === "number" ? item.battmV : null,
        });
      }
    }

    parsed.sort((a, b) => a.t - b.t);

    // Deduplicate identical timestamps
    const deduped = [];
    for (let i = 0; i < parsed.length; i++) {
      if (i === 0 || parsed[i].t !== parsed[i - 1].t) {
        deduped.push(parsed[i]);
      }
    }
    return deduped;
  }

  // Binary search lower bound for t >= minT
  function slicePointsInWindow(points, minT, maxT) {
    if (!points || points.length === 0) return [];
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < minT) lo = mid + 1;
      else hi = mid;
    }
    const startIdx = lo;
    let endIdx = points.length;
    while (endIdx > startIdx && points[endIdx - 1].t > maxT) {
      endIdx--;
    }
    return points.slice(startIdx, endIdx);
  }

  // O(log N) binary search for nearest point to targetT
  function findNearestPoint(pts, targetT) {
    if (!pts || pts.length === 0) return null;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t < targetT) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(pts[lo - 1].t - targetT) <= Math.abs(pts[lo].t - targetT)) {
      return pts[lo - 1];
    }
    return pts[lo];
  }

  // Automatic Min/Max pixel-bucket downsampling to preserve exact peaks/troughs at 60fps
  function downsampleMinMax(pts, maxBuckets) {
    const n = pts.length;
    if (n <= maxBuckets * 2 || maxBuckets < 16) return pts;

    const out = [pts[0]];
    const bucketSize = (n - 2) / maxBuckets;

    for (let b = 0; b < maxBuckets; b++) {
      const start = 1 + Math.floor(b * bucketSize);
      const end = Math.min(n - 1, 1 + Math.floor((b + 1) * bucketSize));
      if (start >= end) continue;

      let minPt = pts[start];
      let maxPt = pts[start];
      let minIdx = start;
      let maxIdx = start;

      for (let i = start + 1; i < end; i++) {
        const p = pts[i];
        if (p.temp < minPt.temp) {
          minPt = p;
          minIdx = i;
        }
        if (p.temp > maxPt.temp) {
          maxPt = p;
          maxIdx = i;
        }
      }

      if (minIdx === maxIdx) {
        out.push(minPt);
      } else if (minIdx < maxIdx) {
        out.push(minPt, maxPt);
      } else {
        out.push(maxPt, minPt);
      }
    }

    out.push(pts[n - 1]);
    return out;
  }

  function getActiveWindow(visibleStations = null) {
    const cfg = RANGE_CONFIG[state.range] || RANGE_CONFIG.week;
    const maxT = state.referenceNowMs;
    let minT;

    if (state.range === "ytd") {
      const refYear = new Date(maxT).getFullYear();
      minT = new Date(refYear, 0, 1, 0, 0, 0, 0).getTime();
    } else if (state.range === "all") {
      let earliest = Infinity;
      const list = visibleStations || state.stations;
      for (let i = 0; i < list.length; i++) {
        const pts = list[i].points;
        if (pts && pts.length > 0 && pts[0].t < earliest) {
          earliest = pts[0].t;
        }
      }
      minT = Number.isFinite(earliest) ? earliest : state.earliestGlobalMs;
    } else {
      minT = maxT - cfg.ms;
    }

    if (minT >= maxT) {
      minT = maxT - 7 * DAY_MS;
    }
    return { minT, maxT, spanMs: maxT - minT, cfg };
  }

  function getVisibleStations() {
    const q = state.search.trim().toLowerCase();
    const list = state.stations.filter((st) => {
      if (state.region !== "all" && st.regionId !== state.region) return false;
      if (state.hideWinterStorage && st.inWinterStorage) return false;
      if (q && !st.name.toLowerCase().includes(q) && !st.regionLabel.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (state.sort === "temp-desc") {
        return (b.latestTemp ?? -999) - (a.latestTemp ?? -999);
      }
      if (state.sort === "temp-asc") {
        return (a.latestTemp ?? 999) - (b.latestTemp ?? 999);
      }
      if (state.sort === "updated") {
        return (b.latestMs ?? 0) - (a.latestMs ?? 0);
      }
      return a.name.localeCompare(b.name, "fi");
    });

    return list;
  }

  // Setup high-DPI canvas
  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  // Compute nice Y axis bounds
  function computeYBounds(minVal, maxVal) {
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
      return { yMin: 0, yMax: 10, step: 2 };
    }
    let span = maxVal - minVal;
    if (span < 1.2) {
      const mid = (minVal + maxVal) / 2;
      minVal = mid - 0.8;
      maxVal = mid + 0.8;
      span = maxVal - minVal;
    } else {
      const pad = span * 0.1;
      minVal -= pad;
      maxVal += pad;
      span = maxVal - minVal;
    }

    const rawStep = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const residual = rawStep / mag;
    let step = mag;
    if (residual > 5) step = 10 * mag;
    else if (residual > 2) step = 5 * mag;
    else if (residual > 1) step = 2 * mag;
    step = Math.max(0.2, step);

    const yMin = Math.floor(minVal / step) * step;
    const yMax = Math.ceil(maxVal / step) * step;
    return { yMin, yMax: yMax === yMin ? yMin + step : yMax, step };
  }

  // Render Combined Multi-Sensor Chart
  function renderOverviewChart(visibleStations, hoverX = null) {
    if (state.overviewCollapsed) return;
    const canvas = el.overviewCanvas;
    const { ctx, width, height } = prepareCanvas(canvas);
    const dark = isDarkTheme();
    const { minT, maxT, spanMs, cfg } = getActiveWindow(visibleStations);

    ctx.clearRect(0, 0, width, height);

    const padLeft = 44;
    const padRight = 14;
    const padTop = 14;
    const padBottom = 26;
    const plotW = Math.max(10, width - padLeft - padRight);
    const plotH = Math.max(10, height - padTop - padBottom);
    const maxBuckets = Math.max(160, Math.floor(plotW * 0.65));

    // Gather series within window and apply automatic min/max downsampling
    const activeSeries = [];
    let globalMin = Infinity;
    let globalMax = -Infinity;

    for (const st of visibleStations) {
      const pts = slicePointsInWindow(st.points, minT, maxT);
      if (pts.length === 0) continue;
      const drawPts = downsampleMinMax(pts, maxBuckets);
      activeSeries.push({ st, pts, drawPts });
      const isFocused = !state.focusedStationKey || state.focusedStationKey === st.key;
      if (isFocused) {
        for (let i = 0; i < drawPts.length; i++) {
          const v = drawPts[i].temp;
          if (v < globalMin) globalMin = v;
          if (v > globalMax) globalMax = v;
        }
      }
    }

    if (!Number.isFinite(globalMin)) {
      for (const { drawPts } of activeSeries) {
        for (let i = 0; i < drawPts.length; i++) {
          const v = drawPts[i].temp;
          if (v < globalMin) globalMin = v;
          if (v > globalMax) globalMax = v;
        }
      }
    }

    const { yMin, yMax, step } = computeYBounds(globalMin, globalMax);

    const xOf = (t) => padLeft + ((t - minT) / (maxT - minT)) * plotW;
    const yOf = (v) => padTop + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    // Grid & Y labels
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--grid-line").trim();
    const textMuted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim();

    for (let yVal = yMin; yVal <= yMax + step * 0.001; yVal += step) {
      const y = Math.round(yOf(yVal)) + 0.5;
      if (y < padTop - 2 || y > padTop + plotH + 2) continue;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = textMuted;
      const label = Math.abs(step) < 1 ? yVal.toFixed(1) : yVal.toFixed(0);
      ctx.fillText(`${label}°`, padLeft - 7, y);
    }

    // X-axis ticks
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tickCount = cfg.ticks;
    for (let i = 0; i <= tickCount; i++) {
      const frac = i / tickCount;
      const t = minT + frac * (maxT - minT);
      const x = Math.round(xOf(t)) + 0.5;

      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();

      if (i > 0 && i < tickCount) {
        ctx.fillStyle = textMuted;
        ctx.fillText(formatAxisTick(t, state.range, spanMs), x, padTop + plotH + 7);
      }
    }

    if (activeSeries.length === 0) {
      ctx.fillStyle = textMuted;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        state.loadedHistories < state.totalStations
          ? "Loading sensor time series…"
          : "No sensor measurements in this time range",
        padLeft + plotW / 2,
        padTop + plotH / 2
      );
      el.overviewTooltip.hidden = true;
      return;
    }

    const highlightKey = state.hoveredStationKey || state.focusedStationKey;

    // Draw non-highlighted sensor lines first, then highlighted sensor on top
    const ordered = [...activeSeries].sort((a, b) => {
      const aHi = a.st.key === highlightKey ? 1 : 0;
      const bHi = b.st.key === highlightKey ? 1 : 0;
      return aHi - bHi;
    });

    for (const { st, drawPts } of ordered) {
      const isHighlighted = highlightKey === st.key;
      const isDimmed = highlightKey && !isHighlighted;
      ctx.strokeStyle = isDimmed
        ? st.colorSpec.alpha(dark, 0.16)
        : st.colorSpec.css(dark);
      ctx.lineWidth = isHighlighted ? 2.6 : 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.beginPath();
      for (let i = 0; i < drawPts.length; i++) {
        const px = xOf(drawPts[i].t);
        const py = yOf(drawPts[i].temp);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Latest endpoint dot
      if (!isDimmed && drawPts.length > 0) {
        const last = drawPts[drawPts.length - 1];
        ctx.fillStyle = st.colorSpec.css(dark);
        ctx.beginPath();
        ctx.arc(xOf(last.t), yOf(last.temp), isHighlighted ? 3.5 : 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Hover crosshair & multi-sensor tooltip (O(log N) binary search per series)
    if (hoverX !== null && hoverX >= padLeft && hoverX <= padLeft + plotW) {
      const hoverT = minT + ((hoverX - padLeft) / plotW) * (maxT - minT);
      const crosshairColor = getComputedStyle(document.documentElement).getPropertyValue("--crosshair").trim();

      ctx.strokeStyle = crosshairColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, padTop);
      ctx.lineTo(hoverX, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const maxSnapDistMs = Math.max(6 * 3600 * 1000, spanMs * 0.05);
      const hits = [];
      for (const { st, pts } of activeSeries) {
        if (state.focusedStationKey && st.key !== state.focusedStationKey) continue;
        const best = findNearestPoint(pts, hoverT);
        if (best && Math.abs(best.t - hoverT) <= maxSnapDistMs) {
          hits.push({ st, pt: best });
        }
      }

      hits.sort((a, b) => b.pt.temp - a.pt.temp);

      if (hits.length > 0) {
        for (const h of hits.slice(0, 10)) {
          ctx.fillStyle = h.st.colorSpec.css(dark);
          ctx.beginPath();
          ctx.arc(xOf(h.pt.t), yOf(h.pt.temp), 3.6, 0, Math.PI * 2);
          ctx.fill();
        }

        const topHits = hits.slice(0, 8);
        const moreCount = hits.length - topHits.length;
        const rowsHtml = topHits
          .map(
            (h) => `
            <div class="tooltip-row">
              <span class="tooltip-sensor">
                <span class="color-swatch" style="background:${h.st.colorSpec.css(dark)}"></span>
                <span>${escapeHtml(h.st.name.replace(/ uimaranta| uimala/i, ""))}</span>
              </span>
              <strong>${formatTemp(h.pt.temp)}</strong>
            </div>`
          )
          .join("");

        el.overviewTooltip.innerHTML = `
          <div class="tooltip-time">${formatDateTime(hoverT)}</div>
          ${rowsHtml}
          ${moreCount > 0 ? `<div class="tooltip-time" style="border:0;margin-top:3px;padding:0">+${moreCount} more sensors</div>` : ""}
        `;
        el.overviewTooltip.hidden = false;

        const ttW = el.overviewTooltip.offsetWidth || 190;
        const left = hoverX + 14 + ttW > width ? Math.max(8, hoverX - ttW - 12) : hoverX + 14;
        el.overviewTooltip.style.left = `${left}px`;
        el.overviewTooltip.style.top = `12px`;
      } else {
        el.overviewTooltip.hidden = true;
      }
    } else {
      el.overviewTooltip.hidden = true;
    }
  }

  // Render Individual Station Chart
  function renderStationChart(st, hoverX = null) {
    if (!st.dom || !st.dom.canvas) return;
    const canvas = st.dom.canvas;
    const tooltip = st.dom.tooltip;
    const { ctx, width, height } = prepareCanvas(canvas);
    const dark = isDarkTheme();
    const { minT, maxT, spanMs, cfg } = getActiveWindow();

    ctx.clearRect(0, 0, width, height);

    const padLeft = 42;
    const padRight = 12;
    const padTop = 10;
    const padBottom = 22;
    const plotW = Math.max(10, width - padLeft - padRight);
    const plotH = Math.max(10, height - padTop - padBottom);
    const maxBuckets = Math.max(140, Math.floor(plotW * 0.7));

    const pts = slicePointsInWindow(st.points, minT, maxT);
    const drawPts = downsampleMinMax(pts, maxBuckets);
    const shortRange = cfg.short || state.range;

    // Compute period stats & update card metric DOM (drawPts preserves exact min and max)
    let minPt = null;
    let maxPt = null;
    for (let i = 0; i < drawPts.length; i++) {
      const p = drawPts[i];
      if (!minPt || p.temp < minPt.temp) minPt = p;
      if (!maxPt || p.temp > maxPt.temp) maxPt = p;
    }

    if (st.dom.rangeStats) {
      if (pts.length >= 1) {
        const firstTemp = pts[0].temp;
        const lastTemp = pts[pts.length - 1].temp;
        const delta = lastTemp - firstTemp;
        const sign = delta > 0 ? "+" : "";
        const deltaClass = delta > 0.05 ? "delta-pos" : delta < -0.05 ? "delta-neg" : "";
        st.dom.rangeStats.innerHTML = `
          <div class="metric-block">
            <span class="metric-label">Min / Max (${shortRange})</span>
            <span class="metric-value">${minPt.temp.toFixed(2)}° / ${maxPt.temp.toFixed(2)}°</span>
          </div>
          <div class="metric-block">
            <span class="metric-label">Δ ${shortRange}</span>
            <span class="metric-value ${deltaClass}">${sign}${delta.toFixed(2)} °C</span>
          </div>
        `;
      } else {
        st.dom.rangeStats.innerHTML = `
          <div class="metric-block">
            <span class="metric-label">Min / Max (${shortRange})</span>
            <span class="metric-value">–</span>
          </div>
        `;
      }
    }

    const { yMin, yMax, step } = computeYBounds(
      minPt ? minPt.temp : (st.latestTemp ?? 5) - 1,
      maxPt ? maxPt.temp : (st.latestTemp ?? 5) + 1
    );

    const xOf = (t) => padLeft + ((t - minT) / (maxT - minT)) * plotW;
    const yOf = (v) => padTop + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--grid-line").trim();
    const textMuted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim();

    ctx.font = '10.5px "JetBrains Mono", monospace';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let yVal = yMin; yVal <= yMax + step * 0.001; yVal += step) {
      const y = Math.round(yOf(yVal)) + 0.5;
      if (y < padTop - 2 || y > padTop + plotH + 2) continue;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = textMuted;
      const label = Math.abs(step) < 1 ? yVal.toFixed(1) : yVal.toFixed(0);
      ctx.fillText(`${label}°`, padLeft - 6, y);
    }

    // X-axis ticks
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tickCount = cfg.ticks;
    for (let i = 0; i <= tickCount; i++) {
      const frac = i / tickCount;
      const t = minT + frac * (maxT - minT);
      const x = Math.round(xOf(t)) + 0.5;
      if (i > 0 && i < tickCount) {
        ctx.fillStyle = textMuted;
        ctx.fillText(formatAxisTick(t, state.range, spanMs), x, padTop + plotH + 5);
      }
    }

    if (drawPts.length === 0) {
      ctx.fillStyle = textMuted;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        st.historyLoaded ? `No readings in selected ${cfg.label} window` : "Loading sensor history…",
        padLeft + plotW / 2,
        padTop + plotH / 2
      );
      tooltip.hidden = true;
      return;
    }

    const strokeColor = st.colorSpec.css(dark);

    // Subtle area fill under curve
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, st.colorSpec.alpha(dark, 0.24));
    grad.addColorStop(1, st.colorSpec.alpha(dark, 0.01));

    ctx.beginPath();
    for (let i = 0; i < drawPts.length; i++) {
      const px = xOf(drawPts[i].t);
      const py = yOf(drawPts[i].temp);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineTo(xOf(drawPts[drawPts.length - 1].t), padTop + plotH);
    ctx.lineTo(xOf(drawPts[0].t), padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Main sensor temperature curve
    ctx.beginPath();
    for (let i = 0; i < drawPts.length; i++) {
      const px = xOf(drawPts[i].t);
      const py = yOf(drawPts[i].temp);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.85;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Latest point dot
    const lastPt = drawPts[drawPts.length - 1];
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.arc(xOf(lastPt.t), yOf(lastPt.temp), 3, 0, Math.PI * 2);
    ctx.fill();

    // Hover crosshair & point inspection (O(log N) binary search on full points in window)
    if (hoverX !== null && hoverX >= padLeft && hoverX <= padLeft + plotW) {
      const hoverT = minT + ((hoverX - padLeft) / plotW) * (maxT - minT);
      const nearest = findNearestPoint(pts, hoverT);
      if (!nearest) {
        tooltip.hidden = true;
        return;
      }

      const snapX = xOf(nearest.t);
      const snapY = yOf(nearest.temp);
      const crosshairColor = getComputedStyle(document.documentElement).getPropertyValue("--crosshair").trim();

      ctx.strokeStyle = crosshairColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(snapX, padTop);
      ctx.lineTo(snapX, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(snapX, snapY, 4.2, 0, Math.PI * 2);
      ctx.fill();

      const battStr = nearest.batt ? ` • ${(nearest.batt / 1000).toFixed(2)} V` : "";
      tooltip.innerHTML = `
        <div class="tooltip-time">${formatDateTime(nearest.t)}${battStr}</div>
        <div class="tooltip-row">
          <span class="tooltip-sensor">
            <span class="color-swatch" style="background:${strokeColor}"></span>
            <span>${escapeHtml(st.name)}</span>
          </span>
          <strong>${formatTemp(nearest.temp)}</strong>
        </div>
      `;
      tooltip.hidden = false;
      const ttW = tooltip.offsetWidth || 180;
      const left = snapX + 12 + ttW > width ? Math.max(8, snapX - ttW - 12) : snapX + 12;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `8px`;
    } else {
      tooltip.hidden = true;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Render interactive sensor color legend in overview panel
  function renderLegend(visibleStations) {
    const dark = isDarkTheme();
    el.sensorLegend.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const st of visibleStations) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "legend-chip";
      if (state.focusedStationKey === st.key) {
        chip.classList.add("active-focus");
      } else if (state.focusedStationKey && state.focusedStationKey !== st.key) {
        chip.classList.add("dimmed");
      }

      const shortName = st.name.replace(/ uimaranta| uimala/i, "");
      chip.innerHTML = `
        <span class="color-swatch" style="background:${st.colorSpec.css(dark)}"></span>
        <span>${escapeHtml(shortName)}</span>
        <span class="legend-temp">${formatTempShort(st.latestTemp)}</span>
      `;

      chip.addEventListener("mouseenter", () => {
        state.hoveredStationKey = st.key;
        renderOverviewChart(getVisibleStations());
      });
      chip.addEventListener("mouseleave", () => {
        state.hoveredStationKey = null;
        renderOverviewChart(getVisibleStations());
      });
      chip.addEventListener("click", () => {
        state.focusedStationKey = state.focusedStationKey === st.key ? null : st.key;
        el.resetHighlightBtn.hidden = !state.focusedStationKey;
        renderLegend(getVisibleStations());
        renderOverviewChart(getVisibleStations());
      });

      frag.appendChild(chip);
    }

    el.sensorLegend.appendChild(frag);
  }

  // Create or update station card DOM
  function createStationCard(st) {
    const dark = isDarkTheme();
    const card = document.createElement("article");
    card.className = "station-card";
    card.dataset.key = st.key;

    const swatchColor = st.colorSpec.css(dark);
    const metaParts = [];
    if (st.platform) metaParts.push(st.platform);
    if (typeof st.depth === "number") metaParts.push(`${st.depth} m`);
    if (st.battmV) metaParts.push(`${(st.battmV / 1000).toFixed(2)} V`);
    if (st.latestMs) {
      metaParts.push(`${formatDateTime(st.latestMs)} (${formatRelativeAge(st.latestMs, state.referenceNowMs)})`);
    }

    card.innerHTML = `
      <div class="station-header">
        <div class="station-id-group">
          <div class="station-name-row">
            <span class="station-swatch" style="background:${swatchColor}"></span>
            <h3 class="station-name">${escapeHtml(st.name)}</h3>
            <span class="badge">${escapeHtml(st.regionLabel)}</span>
            ${st.info ? `<span class="badge badge-warn">${escapeHtml(st.info)}</span>` : ""}
          </div>
          <div class="station-submeta">
            <span>${escapeHtml(metaParts.join(" • "))}</span>
          </div>
        </div>
        <div class="station-metrics">
          <div class="station-range-stats" style="display:flex;gap:18px;align-items:baseline;"></div>
          <div class="metric-block metric-primary">
            <span class="metric-label">Current</span>
            <span class="metric-value" style="color:${swatchColor}">${formatTemp(st.latestTemp)}</span>
          </div>
        </div>
      </div>
      <div class="station-chart-wrap">
        <canvas class="chart-canvas"></canvas>
        <div class="chart-tooltip" hidden></div>
      </div>
    `;

    const canvas = card.querySelector("canvas");
    const tooltip = card.querySelector(".chart-tooltip");
    const swatchEl = card.querySelector(".station-swatch");
    const primaryValEl = card.querySelector(".metric-primary .metric-value");
    const rangeStats = card.querySelector(".station-range-stats");

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      renderStationChart(st, e.clientX - rect.left);
    });
    canvas.addEventListener("mouseleave", () => {
      renderStationChart(st, null);
    });

    st.dom = { card, canvas, tooltip, swatchEl, primaryValEl, rangeStats };
    return card;
  }

  // Render Map View (Latest sensor temperatures only, Coolwarm colormap + legend)
  function ensureMapInitialized() {
    if (typeof window.L === "undefined" || !el.stationsMap) return null;

    if (!state.mapInstance) {
      state.mapInstance = window.L.map(el.stationsMap, {
        center: [60.175, 24.88],
        zoom: 11,
        zoomControl: true,
      });
      state.mapTileLayer = window.L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }
      ).addTo(state.mapInstance);
      state.mapMarkersLayer = window.L.layerGroup().addTo(state.mapInstance);
    }
    return state.mapInstance;
  }

  function renderMapView(visibleStations, fitBounds = false) {
    if (state.view !== "map") return;
    const map = ensureMapInitialized();
    if (!map) return;

    state.mapMarkersLayer.clearLayers();

    const geoStations = visibleStations.filter(
      (st) => typeof st.lat === "number" && typeof st.lon === "number" && typeof st.latestTemp === "number"
    );

    let minTemp = Infinity;
    let maxTemp = -Infinity;
    for (const st of geoStations) {
      if (st.latestTemp < minTemp) minTemp = st.latestTemp;
      if (st.latestTemp > maxTemp) maxTemp = st.latestTemp;
    }

    if (Number.isFinite(minTemp) && Number.isFinite(maxTemp)) {
      const midTemp = (minTemp + maxTemp) / 2;
      el.cwMinVal.textContent = `${minTemp.toFixed(2)} °C`;
      el.cwMidVal.textContent = `${midTemp.toFixed(2)} °C`;
      el.cwMaxVal.textContent = `${maxTemp.toFixed(2)} °C`;
      el.mapCaption.textContent = `${geoStations.length} stations • Latest readings only • Range ${minTemp.toFixed(2)} °C – ${maxTemp.toFixed(2)} °C`;
    } else {
      el.cwMinVal.textContent = "–";
      el.cwMidVal.textContent = "–";
      el.cwMaxVal.textContent = "–";
      el.mapCaption.textContent = "No stations with coordinates in current filter";
    }

    const bounds = [];
    for (const st of geoStations) {
      const { bg, fg } = coolwarmColor(st.latestTemp, minTemp, maxTemp);
      const shortTemp = `${st.latestTemp.toFixed(1)}°`;
      const icon = window.L.divIcon({
        className: "cw-marker-wrapper",
        html: `<div class="cw-marker" style="background:${bg};color:${fg}" title="${escapeHtml(st.name)}: ${formatTemp(st.latestTemp)}">
          <span>${shortTemp}</span>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = window.L.marker([st.lat, st.lon], { icon });
      const metaLines = [];
      if (st.platform) metaLines.push(escapeHtml(st.platform));
      if (typeof st.depth === "number") metaLines.push(`${st.depth} m`);
      if (st.battmV) metaLines.push(`${(st.battmV / 1000).toFixed(2)} V`);

      const popupHtml = `
        <div class="map-popup">
          <div class="map-popup-title">
            <span class="color-swatch" style="background:${bg};border:1px solid rgba(255,255,255,0.5)"></span>
            <span>${escapeHtml(st.name)}</span>
          </div>
          <div class="map-popup-temp" style="color:${bg}">${formatTemp(st.latestTemp)}</div>
          <div class="map-popup-meta">
            <div>${escapeHtml(st.regionLabel)}${metaLines.length ? " • " + metaLines.join(" • ") : ""}</div>
            <div>Measured: ${formatDateTime(st.latestMs)} (${formatRelativeAge(st.latestMs, state.referenceNowMs)})</div>
            ${st.info ? `<div style="color:#fbbf24;margin-top:2px">${escapeHtml(st.info)}</div>` : ""}
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml, { closeButton: false, offset: [0, -10] });
      marker.addTo(state.mapMarkersLayer);
      bounds.push([st.lat, st.lon]);
    }

    setTimeout(() => {
      map.invalidateSize();
      if (fitBounds && bounds.length > 0) {
        map.fitBounds(bounds, { padding: [42, 42], maxZoom: 13 });
      }
    }, 30);
  }

  // Render full view (Combined chart + Legend + Station cards OR Map view)
  function renderAll(fitMapBounds = false) {
    const visible = getVisibleStations();
    const dark = isDarkTheme();
    const rangeLabel = RANGE_CONFIG[state.range]?.label || "7 days";

    const isMap = state.view === "map";
    el.chartsView.hidden = isMap;
    el.mapView.hidden = !isMap;
    // Map shows only latest data and no history option
    el.rangePicker.hidden = isMap;
    el.sortSelect.hidden = isMap;

    if (isMap) {
      renderMapView(visible, fitMapBounds);
      return;
    }

    el.overviewCaption.textContent = `${visible.length} sensors plotted in single view • Window: ${rangeLabel} • Click any sensor below to isolate`;
    el.stationsCountLabel.textContent = `Showing ${visible.length} of ${state.stations.length} stations (${rangeLabel})`;

    renderLegend(visible);
    renderOverviewChart(visible);

    el.stationsList.innerHTML = "";
    if (visible.length === 0) {
      el.stationsList.innerHTML = `<div class="empty-state">No stations match your current filter.</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const st of visible) {
      if (!st.dom) {
        createStationCard(st);
      } else {
        const c = st.colorSpec.css(dark);
        st.dom.swatchEl.style.background = c;
        st.dom.primaryValEl.style.color = c;
      }
      frag.appendChild(st.dom.card);
    }
    el.stationsList.appendChild(frag);

    for (const st of visible) {
      renderStationChart(st);
    }
  }

  // Fetch initial featurecollection.geojson files and stream individual station histories
  async function loadTelemetry() {
    el.refreshBtn.classList.add("spinning");
    el.liveIndicator.classList.remove("ready");
    el.errorBanner.hidden = true;
    el.loadingFill.style.opacity = "1";
    el.loadingFill.style.width = "8%";

    try {
      const regionResponses = await Promise.all(
        REGIONS.map(async (r) => {
          const res = await fetch(`${API_BASE}/${r.id}/featurecollection.geojson`, {
            cache: "no-cache",
          });
          if (!res.ok) throw new Error(`${r.id} returned HTTP ${res.status}`);
          const data = await res.json();
          return { region: r, features: data.features || [] };
        })
      );

      const stations = [];
      let idx = 0;
      let maxLatestMs = 0;

      for (const { region, features } of regionResponses) {
        for (const feat of features) {
          const st = normalizeFeature(feat, region, idx++);
          if (st.latestMs && st.latestMs > maxLatestMs) {
            maxLatestMs = st.latestMs;
          }
          stations.push(st);
        }
      }

      state.stations = stations;
      state.stationByKey = new Map(stations.map((s) => [s.key, s]));
      state.totalStations = stations.length;
      state.loadedHistories = 0;
      state.referenceNowMs = maxLatestMs > 0 ? maxLatestMs : Date.now();

      // Update region counts
      const helsinkiCount = stations.filter((s) => s.regionId === "swimhelsinki").length;
      const espooCount = stations.filter((s) => s.regionId === "swimespoo").length;
      el.countAll.textContent = String(stations.length);
      el.countHelsinki.textContent = String(helsinkiCount);
      el.countEspoo.textContent = String(espooCount);

      el.statusSummary.textContent = `${stations.length} stations discovered • Loading time series (0/${stations.length})…`;
      renderAll();

      // Concurrent worker pool to load all 34 GeoJSON histories smoothly
      const queue = [...stations];
      const concurrency = 6;
      const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
          const st = queue.shift();
          if (!st) break;
          try {
            const res = await fetch(st.geojsonUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const geojson = await res.json();
            st.points = parseStationGeojson(geojson);
            if (st.points.length > 0) {
              const firstPt = st.points[0];
              if (firstPt.t < state.earliestGlobalMs) {
                state.earliestGlobalMs = firstPt.t;
              }
              const lastPt = st.points[st.points.length - 1];
              if (!st.latestMs || lastPt.t >= st.latestMs) {
                st.latestMs = lastPt.t;
                st.latestTemp = lastPt.temp;
              }
            }
            st.historyLoaded = true;
          } catch (err) {
            st.historyError = err.message;
            st.historyLoaded = true;
          }

          state.loadedHistories++;
          const pct = Math.round((state.loadedHistories / state.totalStations) * 100);
          el.loadingFill.style.width = `${pct}%`;
          el.statusSummary.textContent = `${state.totalStations} stations • Loaded ${state.loadedHistories}/${state.totalStations} histories`;

          renderStationChart(st);
          if (state.loadedHistories % 4 === 0 || state.loadedHistories === state.totalStations) {
            renderOverviewChart(getVisibleStations());
          }
        }
      });

      await Promise.all(workers);

      if (state.view === "map") {
        renderMapView(getVisibleStations());
      }

      el.liveIndicator.classList.add("ready");
      el.statusSummary.textContent = `${state.totalStations} sensors active • Latest reading ${formatDateTime(state.referenceNowMs)}`;
      el.lastSyncLabel.textContent = `Synced ${new Date().toLocaleTimeString("fi-FI")}`;
      setTimeout(() => {
        el.loadingFill.style.opacity = "0";
      }, 450);
    } catch (err) {
      el.errorBanner.textContent = `Failed to load telemetry from api.sensoripaja.fi: ${err.message}`;
      el.errorBanner.hidden = false;
      el.statusSummary.textContent = "Connection error — retry with refresh button";
    } finally {
      el.refreshBtn.classList.remove("spinning");
    }
  }

  // Event Listeners
  function bindEvents() {
    // Main View Tabs: Charts vs Map
    if (el.viewTabs) {
      el.viewTabs.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-view]");
        if (!btn) return;
        const view = btn.dataset.view;
        if (view === state.view) return;
        state.view = view;
        for (const b of el.viewTabs.querySelectorAll(".seg-btn")) {
          const isActive = b.dataset.view === view;
          b.classList.toggle("active", isActive);
          b.setAttribute("aria-selected", String(isActive));
        }
        renderAll(view === "map");
      });
    }

    // Time range picker
    el.rangePicker.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      const range = btn.dataset.range;
      if (!RANGE_CONFIG[range] || range === state.range) return;
      state.range = range;
      for (const b of el.rangePicker.querySelectorAll(".seg-btn")) {
        b.classList.toggle("active", b.dataset.range === range);
      }
      renderAll();
    });

    // Region filter
    el.regionPicker.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-region]");
      if (!btn) return;
      const region = btn.dataset.region;
      if (region === state.region) return;
      state.region = region;
      for (const b of el.regionPicker.querySelectorAll(".seg-btn")) {
        b.classList.toggle("active", b.dataset.region === region);
      }
      renderAll(state.view === "map");
    });

    // Layout picker (Stacked vs Grid)
    el.layoutPicker.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-layout]");
      if (!btn) return;
      const layout = btn.dataset.layout;
      state.layout = layout;
      for (const b of el.layoutPicker.querySelectorAll(".seg-btn")) {
        b.classList.toggle("active", b.dataset.layout === layout);
      }
      el.stationsList.classList.toggle("layout-stack", layout === "stack");
      el.stationsList.classList.toggle("layout-grid", layout === "grid");
      renderAll();
    });

    // Search filter
    el.stationSearch.addEventListener("input", (e) => {
      state.search = e.target.value;
      renderAll();
    });

    // Sort selector
    el.sortSelect.addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderAll();
    });

    // Winter storage filter (synced between Charts and Map views)
    const syncStorageToggle = (checked) => {
      state.hideWinterStorage = checked;
      if (el.hideStorageToggle) el.hideStorageToggle.checked = checked;
      if (el.mapHideStorageToggle) el.mapHideStorageToggle.checked = checked;
      renderAll();
    };
    el.hideStorageToggle.addEventListener("change", (e) => {
      syncStorageToggle(e.target.checked);
    });
    if (el.mapHideStorageToggle) {
      el.mapHideStorageToggle.addEventListener("change", (e) => {
        syncStorageToggle(e.target.checked);
      });
    }

    // Reset isolated sensor highlight
    el.resetHighlightBtn.addEventListener("click", () => {
      state.focusedStationKey = null;
      el.resetHighlightBtn.hidden = true;
      renderLegend(getVisibleStations());
      renderOverviewChart(getVisibleStations());
    });

    // Collapse/expand combined chart
    el.toggleOverviewBtn.addEventListener("click", () => {
      state.overviewCollapsed = !state.overviewCollapsed;
      el.overviewBody.classList.toggle("collapsed", state.overviewCollapsed);
      el.toggleOverviewBtn.textContent = state.overviewCollapsed
        ? "Show combined chart"
        : "Hide combined chart";
      if (!state.overviewCollapsed) {
        renderOverviewChart(getVisibleStations());
      }
    });

    // Overview canvas interactive hover
    el.overviewCanvas.addEventListener("mousemove", (e) => {
      const rect = el.overviewCanvas.getBoundingClientRect();
      renderOverviewChart(getVisibleStations(), e.clientX - rect.left);
    });
    el.overviewCanvas.addEventListener("mouseleave", () => {
      renderOverviewChart(getVisibleStations(), null);
    });

    // Refresh button
    el.refreshBtn.addEventListener("click", () => {
      loadTelemetry();
    });

    // Always use dark mode
    document.documentElement.setAttribute("data-theme", "dark");

    // Responsive redraw on window resize
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        renderAll();
      }, 80);
    });
  }

  bindEvents();
  loadTelemetry();
})();

