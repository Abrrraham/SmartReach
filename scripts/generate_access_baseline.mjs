import fs from 'node:fs/promises';
import path from 'node:path';
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

const L1_SPLIT = /[|｜]+/g;
const L2_SPLIT = /[;；]+/g;

const SPEED_LIMITS = {
  'foot-walking': 72000,
  'cycling-regular': 18000,
  'driving-car': 3600
};

const DEFAULT_THRESHOLDS = [1, 15, 30, 45, 60];
const DEFAULT_SAMPLES = 80;
const DEFAULT_DELAY_MS = 350;
const DEFAULT_RETRY = 3;
const DEFAULT_RETRY_DELAY_MS = 1200;
const DEFAULT_CELL_SIZE = 0.01;

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

await loadEnvFile(path.resolve(process.cwd(), '.env.local'));
await loadEnvFile(path.resolve(process.cwd(), '.env'));

const ORS_KEY = (process.env.VITE_ORS_KEY || process.env.ORS_KEY || '').trim();
if (!ORS_KEY) {
  console.error('[baseline] Missing ORS key. Set VITE_ORS_KEY or ORS_KEY.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.replace(/^--/, '');
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args.set(key, value);
    }
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

function buildGrid(points, cellSize, minLng, minLat) {
  const cells = new Map();
  points.forEach((point) => {
    const x = Math.floor((point.lng - minLng) / cellSize);
    const y = Math.floor((point.lat - minLat) / cellSize);
    const key = `${x}:${y}`;
    if (!cells.has(key)) {
      cells.set(key, []);
    }
    cells.get(key).push(point);
  });
  return { cells, cellSize, minLng, minLat };
}

function queryGrid(grid, bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const x0 = Math.floor((minLng - grid.minLng) / grid.cellSize);
  const y0 = Math.floor((minLat - grid.minLat) / grid.cellSize);
  const x1 = Math.floor((maxLng - grid.minLng) / grid.cellSize);
  const y1 = Math.floor((maxLat - grid.minLat) / grid.cellSize);
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

async function fetchIsochrones(profile, origin, rangesSec, maxRetries, retryDelayMs) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(`https://api.openrouteservice.org/v2/isochrones/${profile}`, {
      method: 'POST',
      headers: {
        Authorization: ORS_KEY,
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
    if (response.ok) {
      return response.json();
    }
    const text = await response.text();
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : retryDelayMs;
      console.warn('[baseline] rate limited, retrying', {
        profile,
        attempt: attempt + 1,
        waitMs
      });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sampleCount = Number.parseInt(args.get('samples') ?? `${DEFAULT_SAMPLES}`, 10);
  const thresholdsMin = (args.get('thresholds') ?? DEFAULT_THRESHOLDS.join(','))
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const profiles = (args.get('profiles') ?? 'foot-walking,cycling-regular,driving-car')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const delayMs = Number.parseInt(args.get('delay') ?? `${DEFAULT_DELAY_MS}`, 10);
  const maxRetries = Number.parseInt(args.get('retry') ?? `${DEFAULT_RETRY}`, 10);
  const retryDelayMs = Number.parseInt(args.get('retryDelay') ?? `${DEFAULT_RETRY_DELAY_MS}`, 10);
  const seed = Number.parseInt(args.get('seed') ?? '42', 10);
  const cellSize = Number.parseFloat(args.get('cell') ?? `${DEFAULT_CELL_SIZE}`);
  const poiPath = args.get('poi') ?? 'public/data/nanjing_poi.json';
  const rulesPath = args.get('rules') ?? 'public/data/type_rules.generated.json';
  const outPath = args.get('out') ?? 'public/data/nanjing_access_baseline.generated.json';

  console.info('[baseline] loading poi', poiPath);
  const rawPoi = JSON.parse(await fs.readFile(poiPath, 'utf-8'));
  const features = rawPoi?.features ?? [];

  let rules = DEFAULT_RULES;
  try {
    const rawRules = JSON.parse(await fs.readFile(rulesPath, 'utf-8'));
    rules = normalizeRules(rawRules);
  } catch (error) {
    console.warn('[baseline] rules fallback', error instanceof Error ? error.message : error);
  }

  const allPoints = [];
  const corePoints = new Map();
  CORE_GROUPS.forEach((group) => corePoints.set(group, []));
  let minLng = Infinity;
  let minLat = Infinity;
  features.forEach((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!coords || coords.length < 2) return;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    allPoints.push({ lng, lat });
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    const props = feature.properties ?? {};
    const group =
      typeof props.type_group === 'string' && props.type_group.trim()
        ? props.type_group.trim()
        : classifyType(props.type ?? props.typecode ?? props['行业大'] ?? '', rules);
    if (corePoints.has(group)) {
      corePoints.get(group).push({ lng, lat });
    }
  });

  if (!allPoints.length) {
    console.error('[baseline] no points found');
    process.exit(1);
  }

  const rng = buildRandom(seed);
  const samplePoints = [];
  for (let i = 0; i < allPoints.length; i += 1) {
    if (samplePoints.length < sampleCount) {
      samplePoints.push(allPoints[i]);
      continue;
    }
    const j = Math.floor(rng() * (i + 1));
    if (j < sampleCount) {
      samplePoints[j] = allPoints[i];
    }
  }

  console.info('[baseline] sample points', samplePoints.length);

  const grids = new Map();
  CORE_GROUPS.forEach((group) => {
    grids.set(group, buildGrid(corePoints.get(group), cellSize, minLng, minLat));
  });

  const baselineByProfile = {};

  for (const profile of profiles) {
    console.info('[baseline] profile', profile);
    const limitSec = SPEED_LIMITS[profile];
    const rangesSec = thresholdsMin.map((value) => value * 60).filter((value) => value <= limitSec);
    if (!rangesSec.length) {
      console.warn('[baseline] skip profile', profile, 'no ranges');
      continue;
    }
    const sampleCounts = [];
    for (let i = 0; i < samplePoints.length; i += 1) {
      const origin = samplePoints[i];
      try {
        const geojson = await fetchIsochrones(profile, origin, rangesSec, maxRetries, retryDelayMs);
        const polygons = mapIsochroneFeatures(geojson, rangesSec);
        if (polygons.some((polygon) => !polygon)) {
          console.warn('[baseline] polygon missing', profile, 'sample', i);
          continue;
        }
        const counts = {};
        for (const group of CORE_GROUPS) {
          const grid = grids.get(group);
          counts[group] = polygons.map((polygon) => {
            const bbox = getPolygonBbox(polygon?.geometry);
            if (!bbox) return 0;
            const candidates = queryGrid(grid, bbox);
            let count = 0;
            candidates.forEach((point) => {
              if (booleanPointInPolygon([point.lng, point.lat], polygon)) {
                count += 1;
              }
            });
            return count;
          });
        }
        sampleCounts.push(counts);
      } catch (error) {
        console.warn('[baseline] request failed', profile, i, error instanceof Error ? error.message : error);
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    const validCount = sampleCounts.length;
    if (!validCount) {
      console.warn('[baseline] no valid samples for', profile);
      continue;
    }

    const categoryMean = {};
    CORE_GROUPS.forEach((group) => {
      const sums = new Array(rangesSec.length).fill(0);
      sampleCounts.forEach((sample) => {
        const values = sample[group] ?? [];
        values.forEach((value, idx) => {
          sums[idx] += value;
        });
      });
      categoryMean[group] = sums.map((value) => Math.round(value / validCount));
    });

    const indexSamples = sampleCounts.map((sample) => {
      return rangesSec.map((_, idx) => {
        let sum = 0;
        let groupCount = 0;
        CORE_GROUPS.forEach((group) => {
          const value = sample[group]?.[idx] ?? 0;
          const base = categoryMean[group]?.[idx] ?? 0;
          const denom = Math.log1p(base + 1);
          const norm = denom > 0 ? Math.log1p(value) / denom : 0;
          sum += Math.min(2, Math.max(0, norm));
          groupCount += 1;
        });
        return groupCount ? sum / groupCount : 0;
      });
    });

    const indexMean = rangesSec.map((_, idx) => {
      const values = indexSamples.map((sample) => sample[idx] ?? 0);
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      return Number(avg.toFixed(3));
    });

    const targetIndex = thresholdsMin.indexOf(15);
    const scoreIndex = targetIndex >= 0 ? targetIndex : 0;
    const scoreSamples = indexSamples.map((sample) => sample[scoreIndex] ?? 0).sort((a, b) => a - b);
    const ratingBreaks = {
      p20: Number(percentile(scoreSamples, 0.2).toFixed(3)),
      p40: Number(percentile(scoreSamples, 0.4).toFixed(3)),
      p60: Number(percentile(scoreSamples, 0.6).toFixed(3)),
      p80: Number(percentile(scoreSamples, 0.8).toFixed(3))
    };

    baselineByProfile[profile] = {
      version: 1,
      city: '南京市',
      thresholdsMin,
      profile,
      coreGroups: CORE_GROUPS,
      categoryMean,
      indexMean,
      ratingBreaks,
      sampleCount: validCount
    };
  }

  const walkingBaseline = baselineByProfile['foot-walking'] ?? baselineByProfile[profiles[0]];
  if (!walkingBaseline) {
    console.error('[baseline] no baseline generated');
    process.exit(1);
  }

  const output = {
    version: 1,
    city: '南京市',
    thresholdsMin,
    profile: walkingBaseline.profile ?? 'foot-walking',
    coreGroups: CORE_GROUPS,
    categoryMean: walkingBaseline.categoryMean,
    indexMean: walkingBaseline.indexMean,
    ratingBreaks: walkingBaseline.ratingBreaks,
    byProfile: baselineByProfile,
    generatedAt: new Date().toISOString()
  };

  const outDir = path.dirname(outPath);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.info('[baseline] written', outPath);
}

main().catch((error) => {
  console.error('[baseline] failed', error);
  process.exit(1);
});
