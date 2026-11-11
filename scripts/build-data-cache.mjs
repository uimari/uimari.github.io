#!/usr/bin/env node
/**
 * Fetches latest featurecollection.geojson and full historical station GeoJSONs
 * from https://api.sensoripaja.fi and builds a compact static cache in ./data/
 * for GitHub Pages (Fastly CDN with automatic Gzip/Brotli compression).
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://api.sensoripaja.fi";
const REGIONS = ["swimhelsinki", "swimespoo"];
const OUT_DIR = path.resolve(process.cwd(), "data");

function parseAndCompactGeojson(data) {
  const raw = data?.properties?.data?.raw;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const parsed = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item.temp_water !== "number" || !item.time) continue;
    const tMs = Date.parse(item.time);
    if (!Number.isNaN(tMs)) {
      const tSec = Math.round(tMs / 1000);
      const temp = Math.round(item.temp_water * 100) / 100;
      const batt = typeof item.battmV === "number" ? Math.round(item.battmV) : null;
      parsed.push(batt !== null ? [tSec, temp, batt] : [tSec, temp]);
    }
  }

  parsed.sort((a, b) => a[0] - b[0]);

  const deduped = [];
  for (let i = 0; i < parsed.length; i++) {
    if (i === 0 || parsed[i][0] !== parsed[i - 1][0]) {
      deduped.push(parsed[i]);
    }
  }
  return deduped;
}

async function fetchJsonWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const stationTasks = [];
  for (const regionId of REGIONS) {
    const url = `${API_BASE}/${regionId}/featurecollection.geojson`;
    const fc = await fetchJsonWithRetry(url);
    const regionDir = path.join(OUT_DIR, regionId);
    await fs.mkdir(regionDir, { recursive: true });
    await fs.writeFile(
      path.join(regionDir, "featurecollection.geojson"),
      JSON.stringify(fc)
    );

    const features = fc.features || [];
    for (const feat of features) {
      const name = feat.properties?.name || feat.id || "Unknown";
      const key = `${regionId}::${name}`;
      const geojsonUrl = `${API_BASE}/${regionId}/${encodeURIComponent(name + ".geojson")}`;
      stationTasks.push({ key, name, regionId, geojsonUrl });
    }
  }

  console.log(`Discovered ${stationTasks.length} stations. Downloading histories...`);

  const histories = {};
  const queue = [...stationTasks];
  const concurrency = 6;

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      try {
        const geojson = await fetchJsonWithRetry(task.geojsonUrl);
        histories[task.key] = parseAndCompactGeojson(geojson);
      } catch (err) {
        console.warn(`Warning: failed to fetch ${task.key}: ${err.message}`);
        histories[task.key] = [];
      }
    }
  });

  await Promise.all(workers);

  const payload = {
    generatedAt: new Date().toISOString(),
    stations: histories,
  };

  const outFile = path.join(OUT_DIR, "histories.json");
  const jsonStr = JSON.stringify(payload);
  await fs.writeFile(outFile, jsonStr);

  const sizeMb = (Buffer.byteLength(jsonStr, "utf8") / (1024 * 1024)).toFixed(2);
  console.log(`Wrote ${outFile} (${sizeMb} MB uncompressed, ${Object.keys(histories).length} stations).`);
}

main().catch((err) => {
  console.error("Failed to build data cache:", err);
  process.exit(1);
});

