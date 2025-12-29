import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { booleanPointInPolygon } from '@turf/turf';

const CORE_GROUPS = [
  'shopping',
  'transport',
  'medical',
  'education_culture',
  'entertainment_sports',
  'public_facility'
];

const DEFAULT_RULES = {
  l1Map: {
    餐饮服务: 'food',
    购物服务: 'shopping',
    生活服务: 'life_service',
    医疗保健服务: 'medical',
    科教文化服务: 'education_culture',
    交通设施服务: 'transport',
    汽车服务: 'transport',
    汽车销售: 'transport',
    汽车维修: 'transport',
    汽车租赁: 'transport',
    住宿服务: 'lodging',
    金融保险服务: 'finance',
    政府机构及社会团体: 'government',
    公司企业: 'company',
    体育休闲服务: 'entertainment_sports',
    风景名胜: 'tourism',
    公共设施: 'public_facility',
    公共设施服务: 'public_facility',
    商务住宅: 'residential_realestate',
    室内设施: 'public_facility'
  },
  l2Overrides: [
    {
      l1: '生活服务',
      match: ['邮局', '公厕', '公共厕所', '公用电话', '垃圾站', '供水', '供电', '通信'],
      group: 'public_facility'
    }
  ],
  priority: [
    'medical',
    'transport',
    'public_facility',
    'education_culture',
    'finance',
    'lodging',
    'shopping',
    'food',
    'life_service',
    'entertainment_sports',
    'tourism',
    'government',
    'company',
    'residential_realestate',
    'other'
  ]
};

const SPEED_LIMITS = {
  'foot-walking': 72000,
  'cycling-regular': 18000,
  'driving-car': 3600
};

const DEFAULT_THRESHOLDS = [1, 15, 30, 45, 60];
const DEFAULT_SAMPLES = 250;
const DEFAULT_GRID_KM = 5;
const DEFAULT_CELL_KM = 1;
const DEFAULT_RPS = 1;
const DEFAULT_SEED = 42;
const DEFAULT_RETRY = 5;
const DEFAULT_RESUME = true;

const L1_SPLIT = /[|｜]+/g;
const L2_SPLIT = /[;；]+/g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
  } catch (error) {
    return;
  }
}

function parseArgs(argv) {
  const args = new Map();
  const multiValueKeys = new Set(['profiles', 'thresholds']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.replace(/^--/, '');
    if (multiValueKeys.has(key)) {
      const values = [];
      let j = i + 1;
      while (j < argv.length && !argv[j].startsWith('--')) {
        values.push(argv[j]);
        j += 1;
      }
      if (values.length) {
        args.set(key, values.join(','));
        i = j - 1;
        continue;
      }
      args.set(key, 'true');
      continue;
    }
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args.set(key, value);
  }
  return args;
}

function buildRandom(seedValue) {
  let seed = Number.isFinite(seedValue) ? seedValue : Date.now() % 100000;
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function cleanRawType(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*]/g, '')
    .replace(/\s+/g, ' ');
}

function splitSegments(raw) {
  return cleanRawType(raw)
    .split(L1_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLevels(segment) {
  return segment
    .split(L2_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyOverrides(l1, l2, l3, rules) {
  for (const override of rules.l2Overrides ?? []) {
    if (override.l1 !== l1) continue;
    const hit = override.match.some((token) => l2.includes(token) || l3.includes(token));
    if (hit) return override.group;
  }
  return undefined;
}

function pickByPriority(groups, priority) {
  const rank = new Map(priority.map((id, index) => [id, index]));
  let winner = 'other';
  let best = rank.get('other') ?? priority.length;
  groups.forEach((group) => {
    const idx = rank.get(group);
    if (idx !== undefined && idx < best) {
      winner = group;
      best = idx;
    }
  });
  return winner;
}

function classifyType(rawType, rules) {
  const raw = cleanRawType(rawType);
  if (!raw) return 'other';
  const segments = splitSegments(raw);
  if (!segments.length) return 'other';
  const segmentGroups = segments.map((segment) => {
    const [l1 = '', l2 = '', l3 = ''] = splitLevels(segment);
    if (!l1) return 'other';
    const baseGroup = rules.l1Map?.[l1];
    if (!baseGroup) return 'other';
    const override = applyOverrides(l1, l2, l3, rules);
    return override ?? baseGroup;
  });
  return pickByPriority(segmentGroups, rules.priority ?? DEFAULT_RULES.priority);
}

function normalizeRules(raw) {
  if (!raw || typeof raw !== 'object') return DEFAULT_RULES;
  const data = raw;
  return {
    l1Map: data.l1Map ?? DEFAULT_RULES.l1Map,
    l2Overrides: Array.isArray(data.l2Overrides) ? data.l2Overrides : DEFAULT_RULES.l2Overrides,
    priority: Array.isArray(data.priority) ? data.priority : DEFAULT_RULES.priority
  };
}

function gcj02ToWgs84(lng, lat) {
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.006693421622965943 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLatAdj = (dLat * 180) / (((6335552.717000426 / (magic * sqrtMagic)) * Math.PI));
  const dLngAdj = (dLng * 180) / (((6378245 / sqrtMagic) * Math.cos(radLat) * Math.PI));
  const mgLat = lat + dLatAdj;
  const mgLng = lng + dLngAdj;
  return [lng * 2 - mgLng, lat * 2 - mgLat];
}

function wgs84ToGcj02(lng, lat) {
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.006693421622965943 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLatAdj = (dLat * 180) / (((6335552.717000426 / (magic * sqrtMagic)) * Math.PI));
  const dLngAdj = (dLng * 180) / (((6378245 / sqrtMagic) * Math.cos(radLat) * Math.PI));
  const mgLat = lat + dLatAdj;
  const mgLng = lng + dLngAdj;
  return [mgLng, mgLat];
}

function transformLat(x, y) {
  let ret =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function transformLng(x, y) {
  let ret =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

function transformCoordinates(coords, fn) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    return fn(coords[0], coords[1]);
  }
  return coords.map((item) => transformCoordinates(item, fn));
}

function transformPolygonFeature(feature, coordSysPoi) {
  if (!feature?.geometry) return feature;
  if (coordSysPoi === 'wgs84') return feature;
  const geometry = feature.geometry;
  const converted = {
    ...feature,
    geometry: {
      ...geometry,
      coordinates: transformCoordinates(geometry.coordinates, wgs84ToGcj02)
    }
  };
  return converted;
}

function getPolygonBbox(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const stack = [geometry.coordinates];
  while (stack.length) {
    const item = stack.pop();
    if (!Array.isArray(item)) continue;
    if (typeof item[0] === 'number' && typeof item[1] === 'number') {
      const lng = item[0];
      const lat = item[1];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    } else {
      item.forEach((child) => stack.push(child));
    }
  }
  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function buildGridIndex(points, cellDeg, minLng, minLat) {
  const cells = new Map();
  points.forEach((point) => {
    const x = Math.floor((point.lng - minLng) / cellDeg);
    const y = Math.floor((point.lat - minLat) / cellDeg);
    const key = `${x}:${y}`;
    if (!cells.has(key)) {
      cells.set(key, []);
    }
    cells.get(key).push(point);
  });
  return { cells, cellDeg, minLng, minLat };
}

function queryGrid(grid, bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const x0 = Math.floor((minLng - grid.minLng) / grid.cellDeg);
  const y0 = Math.floor((minLat - grid.minLat) / grid.cellDeg);
  const x1 = Math.floor((maxLng - grid.minLng) / grid.cellDeg);
  const y1 = Math.floor((maxLat - grid.minLat) / grid.cellDeg);
  const results = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const key = `${x}:${y}`;
      const cell = grid.cells.get(key);
      if (cell) {
        results.push(...cell);
      }
    }
  }
  return results;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

async function requestIsochrones(profile, origin, rangesSec, key, cacheDir, rpsState, retry) {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  const cachePath = path.join(cacheDir, `${hash}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
    rpsState.cacheHit += 1;
    return cached;
  } catch (error) {
    // continue
  }

  const minInterval = 1000 / rpsState.rps;
  const now = Date.now();
  const wait = Math.max(0, rpsState.lastRequestAt + minInterval - now);
  if (wait > 0) {
    await sleep(wait);
  }

  const url = `https://api.openrouteservice.org/v2/isochrones/${profile}`;
  for (let attempt = 0; attempt <= retry.max; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: rpsState.key,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/geo+json, application/json'
      },
      body: JSON.stringify({
        locations: [[origin.lng, origin.lat]],
        range_type: 'time',
        range: rangesSec,
        location_type: 'start',
        smoothing: 0.5,
        attributes: ['area']
      })
    });
    rpsState.lastRequestAt = Date.now();
    if (response.ok) {
      const data = await response.json();
      await fs.writeFile(cachePath, JSON.stringify(data));
      return data;
    }
    const text = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < retry.max) {
      rpsState.rateLimited += response.status === 429 ? 1 : 0;
      const backoff = retry.delayMs * Math.pow(2, attempt);
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : backoff;
      await sleep(waitMs);
      continue;
    }
    throw new Error(`ORS ${response.status} ${response.statusText} ${text.slice(0, 200)}`);
  }
  throw new Error('ORS retry exhausted');
}

function mapIsochroneFeatures(geojson, rangesSec) {
  const featureMap = new Map();
  const features = geojson?.features ?? [];
  features.forEach((feature) => {
    const props = feature.properties ?? {};
    const rawValue = props.value ?? props.contour ?? props.bucket;
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (Number.isFinite(value)) {
      featureMap.set(value, feature);
    }
  });
  return rangesSec.map((range) => featureMap.get(range) ?? featureMap.get(range / 60) ?? null);
}

function computeIndex(countsByGroup, categoryMean) {
  const thresholds = categoryMean[CORE_GROUPS[0]]?.length ?? 0;
  return Array.from({ length: thresholds }, (_, idx) => {
    let sum = 0;
    let groupCount = 0;
    CORE_GROUPS.forEach((group) => {
      const value = countsByGroup[group]?.[idx] ?? 0;
      const base = categoryMean[group]?.[idx] ?? 0;
      const denom = Math.log1p(base + 1);
      const norm = denom > 0 ? Math.log1p(value) / denom : 0;
      sum += Math.min(2, Math.max(0, norm));
      groupCount += 1;
    });
    return groupCount ? sum / groupCount : 0;
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  const hasFlags = rawArgs.some((token) => token.startsWith('--'));
  if (!hasFlags && rawArgs.length) {
    const numericIndex = rawArgs.findIndex((token) => /^[0-9]+(\.[0-9]+)?$/.test(token));
    const profileTokens = numericIndex === -1 ? rawArgs : rawArgs.slice(0, numericIndex);
    if (profileTokens.length) {
      args.set('profiles', profileTokens.join(','));
    }
    if (numericIndex !== -1) {
      if (rawArgs[numericIndex]) args.set('samples', rawArgs[numericIndex]);
      if (rawArgs[numericIndex + 1]) args.set('gridKm', rawArgs[numericIndex + 1]);
      if (rawArgs[numericIndex + 2]) args.set('coordSysPoi', rawArgs[numericIndex + 2]);
    }
  }
  await loadEnvFile(path.resolve(process.cwd(), '.env.local'));
  await loadEnvFile(path.resolve(process.cwd(), '.env'));
  const ORS_KEY = (process.env.ORS_KEY || process.env.VITE_ORS_KEY || '').trim();
  if (!ORS_KEY) {
    console.error('[baseline] Missing ORS key. Set ORS_KEY or VITE_ORS_KEY.');
    process.exit(1);
  }

  const poiPath = args.get('poi') ?? 'public/data/nanjing_poi.json';
  const outPath = args.get('out') ?? 'public/data/nanjing_access_baseline.json';
  const reportPath = args.get('report') ?? 'public/data/nanjing_access_baseline.report.json';
  const cacheDir = args.get('cache') ?? 'cache/ors_isochrones';
  const samplePath = args.get('samplesCache') ?? 'cache/baseline_samples.jsonl';
  const sampleCount = Number.parseInt(args.get('samples') ?? `${DEFAULT_SAMPLES}`, 10);
  const gridKm = Number.parseFloat(args.get('gridKm') ?? `${DEFAULT_GRID_KM}`);
  const cellKm = Number.parseFloat(args.get('cellKm') ?? `${DEFAULT_CELL_KM}`);
  const thresholdsMin = (args.get('thresholds') ?? DEFAULT_THRESHOLDS.join(','))
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const profileArg = (args.get('profile') ?? 'foot-walking').trim();
  const profiles = (args.get('profiles') ?? profileArg)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueProfiles = Array.from(new Set(profiles)).filter((value) => {
    if (!SPEED_LIMITS[value]) {
      console.warn('[baseline] unknown profile, skip', value);
      return false;
    }
    return true;
  });
  const rps = Number.parseFloat(args.get('rps') ?? `${DEFAULT_RPS}`);
  const coordSysPoi = (args.get('coordSysPoi') ?? 'wgs84').toLowerCase();
  const seed = Number.parseInt(args.get('seed') ?? `${DEFAULT_SEED}`, 10);
  const resume = String(args.get('resume') ?? `${DEFAULT_RESUME}`) !== 'false';
  const retryMax = Number.parseInt(args.get('retry') ?? `${DEFAULT_RETRY}`, 10);
  const retryDelayMs = Number.parseInt(args.get('retryDelay') ?? '1200', 10);

  if (!uniqueProfiles.length) {
    console.error('[baseline] no valid profiles, check --profile/--profiles');
    process.exit(1);
  }

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(path.dirname(samplePath), { recursive: true });

  const rawPoi = JSON.parse(await fs.readFile(poiPath, 'utf-8'));
  const features = rawPoi?.features ?? [];
  const poiTotal = features.length;

  let rules = DEFAULT_RULES;
  try {
    const rulesPath = args.get('rules') ?? 'public/data/type_rules.generated.json';
    const rawRules = JSON.parse(await fs.readFile(rulesPath, 'utf-8'));
    rules = normalizeRules(rawRules);
  } catch (error) {
    // fallback
  }

  const allPoints = [];
  const groupPoints = new Map();
  CORE_GROUPS.forEach((group) => groupPoints.set(group, []));
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  features.forEach((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!coords || coords.length < 2) return;
    let lng = Number(coords[0]);
    let lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    allPoints.push({ lng, lat });
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
    const props = feature.properties ?? {};
    const group =
      typeof props.type_group === 'string' && props.type_group.trim()
        ? props.type_group.trim()
        : classifyType(props.type ?? props.typecode ?? props['行业大'] ?? '', rules);
    if (groupPoints.has(group)) {
      groupPoints.get(group).push({ lng, lat });
    }
  });

  const random = buildRandom(seed);
  const avgLat = (minLat + maxLat) / 2;
  const latStep = gridKm / 111;
  const lonStep = gridKm / (111 * Math.cos((avgLat * Math.PI) / 180));
  const grid = new Map();
  allPoints.forEach((point) => {
    const gx = Math.floor((point.lng - minLng) / lonStep);
    const gy = Math.floor((point.lat - minLat) / latStep);
    const key = `${gx}:${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(point);
  });

  const gridKeys = Array.from(grid.keys());
  gridKeys.sort(() => random() - 0.5);
  const samples = [];
  for (const key of gridKeys) {
    if (samples.length >= sampleCount) break;
    const bucket = grid.get(key);
    if (!bucket || !bucket.length) continue;
    const idx = Math.floor(random() * bucket.length);
    samples.push(bucket[idx]);
  }
  if (samples.length < sampleCount) {
    const remaining = allPoints.filter((point) => !samples.includes(point));
    while (samples.length < sampleCount && remaining.length) {
      const idx = Math.floor(random() * remaining.length);
      samples.push(remaining.splice(idx, 1)[0]);
    }
  }

  const cellDeg = cellKm / 111;
  const groupIndexes = new Map();
  CORE_GROUPS.forEach((group) => {
    groupIndexes.set(group, buildGridIndex(groupPoints.get(group), cellDeg, minLng, minLat));
  });

  const seenSampleKeys = new Set();
  const samplesCacheByKey = new Map();
  if (resume) {
    try {
      const rawLines = await fs.readFile(samplePath, 'utf-8');
      rawLines.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        const record = JSON.parse(line);
        const key = record?.key;
        if (key) {
          seenSampleKeys.add(key);
          if (record?.status === 'ok') {
            samplesCacheByKey.set(key, record);
          }
        }
      });
    } catch (error) {
      // ignore
    }
  }

  const rpsState = {
    rps,
    lastRequestAt: 0,
    key: ORS_KEY,
    cacheHit: 0,
    rateLimited: 0
  };

  const baselineByProfile = {};
  const profileReports = {};
  const t0 = Date.now();

  for (const profile of uniqueProfiles) {
    const profileStart = Date.now();
    const thresholdsForProfile = thresholdsMin.filter(
      (value) => value * 60 <= SPEED_LIMITS[profile]
    );
    const rangesSec = thresholdsForProfile.map((value) => value * 60);
    if (!rangesSec.length) {
      console.warn('[baseline] skip profile, no ranges', profile);
      profileReports[profile] = {
        profile,
        samples: { requested: sampleCount, used: 0, failed: 0 },
        failures: [],
        durationSec: 0,
        skipped: 'no_ranges'
      };
      continue;
    }

    const failures = [];
    const usedSamples = [];

    for (let i = 0; i < samples.length; i += 1) {
      const origin = samples[i];
      const key = `${profile}|${origin.lng.toFixed(5)},${origin.lat.toFixed(
        5
      )}|${rangesSec.join(',')}`;
      if (seenSampleKeys.has(key)) {
        const cached = samplesCacheByKey.get(key);
        if (cached) {
          usedSamples.push(cached);
          continue;
        }
      }
      try {
        const originWgs =
          coordSysPoi === 'wgs84' ? { ...origin } : toWgs(origin.lng, origin.lat);
        const response = await requestIsochrones(
          profile,
          originWgs,
          rangesSec,
          key,
          cacheDir,
          rpsState,
          { max: retryMax, delayMs: retryDelayMs }
        );
        const polygons = mapIsochroneFeatures(response, rangesSec).map((feature) =>
          transformPolygonFeature(feature, coordSysPoi)
        );
        if (polygons.some((item) => !item)) {
          throw new Error('IsochroneMissingRange');
        }
        const counts = {};
        for (const group of CORE_GROUPS) {
          const index = groupIndexes.get(group);
          counts[group] = polygons.map((polygon) => {
            const bbox = getPolygonBbox(polygon?.geometry);
            if (!bbox) return 0;
            const candidates = queryGrid(index, bbox);
            let count = 0;
            candidates.forEach((point) => {
              if (booleanPointInPolygon([point.lng, point.lat], polygon)) {
                count += 1;
              }
            });
            return count;
          });
        }
        const record = {
          key,
          origin: { lng: origin.lng, lat: origin.lat },
          profile,
          rangesSec,
          counts,
          status: 'ok'
        };
        usedSamples.push(record);
        await fs.appendFile(samplePath, `${JSON.stringify(record)}\n`);
      } catch (error) {
        failures.push({
          key,
          origin,
          profile,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error)
        });
        await fs.appendFile(
          samplePath,
          `${JSON.stringify({
            key,
            origin,
            profile,
            rangesSec,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error)
          })}\n`
        );
      }
    }

    const nUsed = usedSamples.length;
    if (!nUsed) {
      console.warn('[baseline] no valid samples for', profile);
      profileReports[profile] = {
        profile,
        samples: { requested: sampleCount, used: 0, failed: failures.length },
        failures,
        durationSec: Math.round((Date.now() - profileStart) / 1000),
        skipped: 'no_samples'
      };
      continue;
    }

    const categoryMean = {};
    CORE_GROUPS.forEach((group) => {
      const sums = new Array(rangesSec.length).fill(0);
      usedSamples.forEach((sample) => {
        const values = sample.counts[group] ?? [];
        values.forEach((value, idx) => {
          sums[idx] += value;
        });
      });
      categoryMean[group] = sums.map((value) => Math.round(value / nUsed));
    });

    const sampleIndexes = usedSamples.map((sample) => ({
      key: sample.key,
      index: computeIndex(sample.counts, categoryMean)
    }));
    const indexMean = rangesSec.map((_, idx) => {
      const values = sampleIndexes.map((sample) => sample.index[idx] ?? 0);
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      return Number(avg.toFixed(3));
    });

    const idx15 = thresholdsForProfile.indexOf(15);
    const scoreList = sampleIndexes
      .map((sample) => sample.index[idx15 >= 0 ? idx15 : 0] ?? 0)
      .sort((a, b) => a - b);
    const ratingBreaks = {
      p20: Number(percentile(scoreList, 0.2).toFixed(3)),
      p40: Number(percentile(scoreList, 0.4).toFixed(3)),
      p60: Number(percentile(scoreList, 0.6).toFixed(3)),
      p80: Number(percentile(scoreList, 0.8).toFixed(3))
    };

    const baseline = {
      version: 1,
      city: '南京市',
      generatedAt: new Date().toISOString(),
      poiSource: `${path.basename(poiPath)} (${poiTotal})`,
      profile,
      thresholdsMin: thresholdsForProfile,
      coreGroups: CORE_GROUPS,
      sample: {
        seed,
        nRequested: sampleCount,
        nUsed,
        nFailed: failures.length,
        strategy: 'stratified-grid-from-poi'
      },
      categoryMean,
      indexMean,
      ratingBreaks,
      debug: {
        bbox: [minLng, minLat, maxLng, maxLat],
        notes: `coordSysPoi=${coordSysPoi}, gridKm=${gridKm}, cellKm=${cellKm}, rps=${rps}, retry=${retryMax}`
      }
    };

    baselineByProfile[profile] = baseline;
    profileReports[profile] = {
      profile,
      samples: { requested: sampleCount, used: nUsed, failed: failures.length },
      failures,
      durationSec: Math.round((Date.now() - profileStart) / 1000)
    };
  }

  const profilesGenerated = Object.keys(baselineByProfile);
  if (!profilesGenerated.length) {
    console.error('[baseline] no baseline generated');
    process.exit(1);
  }

  const mainProfile = profilesGenerated.includes('foot-walking')
    ? 'foot-walking'
    : profilesGenerated[0];
  const mainBaseline = baselineByProfile[mainProfile];
  const output = {
    ...mainBaseline,
    profile: mainProfile
  };
  if (profilesGenerated.length > 1) {
    output.byProfile = baselineByProfile;
  }

  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  const totalUsed = profilesGenerated.reduce(
    (sum, profile) => sum + (profileReports[profile]?.samples?.used ?? 0),
    0
  );
  const totalFailed = profilesGenerated.reduce(
    (sum, profile) => sum + (profileReports[profile]?.samples?.failed ?? 0),
    0
  );
  const report = {
    generatedAt: output.generatedAt,
    durationSec: Math.round((Date.now() - t0) / 1000),
    profiles: profilesGenerated,
    samples: {
      requested: sampleCount,
      used: totalUsed,
      failed: totalFailed
    },
    byProfile: profileReports,
    rps: rpsState.rps,
    cacheHit: rpsState.cacheHit,
    rateLimited: rpsState.rateLimited
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.info('[baseline] done', {
    outPath,
    reportPath,
    profiles: profilesGenerated
  });
}

function toWgs(lng, lat) {
  return { lng: gcj02ToWgs84(lng, lat)[0], lat: gcj02ToWgs84(lng, lat)[1] };
}

main().catch((error) => {
  console.error('[baseline] failed', error);
  process.exit(1);
});
