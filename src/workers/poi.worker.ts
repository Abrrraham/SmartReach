import Supercluster from 'supercluster';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';
import { convertCoord, normalizeCoordSys, type CoordSys } from '../utils/coord';
import { booleanPointInPolygon, convex, featureCollection, point as turfPoint } from '@turf/turf';

interface GroupRule {
  id: string;
  label: string;
}

interface TypeRules {
  groups: GroupRule[];
  l1Map: Record<string, string>;
  l2Overrides: Array<{ l1: string; match: string[]; group: string }>;
  priority: string[];
  meta?: Record<string, unknown>;
}

interface CoordSysConfig {
  poiCoordSys: CoordSys;
  mapCoordSys: CoordSys;
}

interface PoiProperties {
  id: string;
  name: string;
  type_group: string;
}

interface RawPoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
  type_group: string;
}

type ClusterProperties = Supercluster.ClusterProperties & Record<string, unknown>;
type PoiFeature = Feature<Point, PoiProperties>;
type ClusterFeature = Feature<Point, PoiProperties | ClusterProperties>;
type PolygonFeature = Feature<Polygon, Record<string, unknown>>;
type IsoPolygonFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;
type IsoPolygonInput = IsoPolygonFeature | null;
type Bbox = [number, number, number, number];
type CountGrid = {
  cellSize: number;
  minLng: number;
  minLat: number;
  cells: Map<string, RawPoint[]>;
};
type SiteCandidate = {
  lng: number;
  lat: number;
  metrics: {
    demand: number;
    access: number;
    competition: number;
    synergy: number;
    center: number;
  };
  total: number;
  debug?: Record<string, number>;
};

const DEFAULT_RULES: TypeRules = {
  groups: [
    { id: 'food', label: '餐饮' },
    { id: 'shopping', label: '购物' },
    { id: 'life_service', label: '生活服务' },
    { id: 'medical', label: '医疗健康' },
    { id: 'education_culture', label: '科教文化' },
    { id: 'transport', label: '交通出行' },
    { id: 'lodging', label: '住宿' },
    { id: 'finance', label: '金融' },
    { id: 'government', label: '政府与社会组织' },
    { id: 'company', label: '公司企业' },
    { id: 'entertainment_sports', label: '文体娱乐' },
    { id: 'tourism', label: '旅游景点' },
    { id: 'public_facility', label: '公共设施' },
    { id: 'residential_realestate', label: '住宅房产' },
    { id: 'other', label: '其他' }
  ],
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
  ],
  meta: { generatedAt: new Date().toISOString(), source: 'fallback' }
};

const LON_KEYS = ['lon', 'lng', 'longitude', '经度', 'x', 'X'];
const LAT_KEYS = ['lat', 'latitude', '纬度', 'y', 'Y'];
const NAME_KEYS = ['name', '名称', 'poi', 'POI_NAME', 'title', 'mc'];
const TYPE_KEYS = ['type', 'category', '类别', '大类', '小类', 'class', 'poiType'];
const SEGMENT_SPLIT = /[|｜]+/g;
const LEVEL_SPLIT = /[;；]+/g;

const HULL_MODE: 'bbox' | 'hull' = 'bbox';
const HULL_MAX_ZOOM = 12;
const HULL_MIN_COUNT = 30;
const HULL_MAX_LEAVES = 300;

const DEV_LOG = import.meta.env.DEV;
const logWorker = (message: string, payload?: Record<string, unknown>) => {
  if (!DEV_LOG) return;
  console.info('[poi-worker]', message, payload ?? {});
};

let rules: TypeRules = DEFAULT_RULES;
let coordConfig: CoordSysConfig = {
  poiCoordSys: 'WGS84',
  mapCoordSys: 'WGS84'
};
let groupPoints = new Map<string, RawPoint[]>();
let groupIndexes = new Map<string, Supercluster<PoiProperties>>();
let groupBboxes = new Map<string, Bbox>();
let isoIndexes = new Map<string, Supercluster<PoiProperties>>();
const countGrids = new Map<string, CountGrid>();
let allIndex: Supercluster<PoiProperties> | null = null;
let typeCounts: Record<string, number> = {};
const COUNT_ZOOM = 15;
const COUNT_GRID_CELL_DEG = 0.01;
const SITE_DEFAULTS = {
  gridSpacingMeters: 400,
  maxCandidates: 800,
  radiusCompetition: 800,
  radiusDemand: 800,
  radiusSynergy: 800,
  radiusAccessMax: 5000
};
const SYNERGY_GROUPS = ['shopping', 'food', 'life_service', 'entertainment_sports', 'tourism'];
const SITE_WEIGHTS = {
  demand: 0.35,
  access: 0.2,
  competition: 0.25,
  synergy: 0.15,
  center: 0.05
};

function cleanRawType(raw: string): string {
  return raw
    .trim()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*]/g, '')
    .replace(/\s+/g, ' ');
}

function splitSegments(raw: string): string[] {
  return cleanRawType(raw)
    .split(SEGMENT_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLevels(segment: string): string[] {
  return segment
    .split(LEVEL_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickByPriority(groups: string[], priority: string[]) {
  const priorityIndex = new Map(priority.map((id, index) => [id, index]));
  let winner = 'other';
  let winnerIndex = priorityIndex.get('other') ?? priority.length;
  groups.forEach((group) => {
    const index = priorityIndex.get(group);
    if (index !== undefined && index < winnerIndex) {
      winner = group;
      winnerIndex = index;
    }
  });
  return winner;
}

function applyOverrides(l1: string, l2: string, l3: string, ruleset: TypeRules) {
  for (const override of ruleset.l2Overrides ?? []) {
    if (override.l1 !== l1) {
      continue;
    }
    const hit = override.match.some((token) => l2.includes(token) || l3.includes(token));
    if (hit) {
      return override.group;
    }
  }
  return undefined;
}

function classifyType(rawType: string, ruleset: TypeRules): string {
  const raw = cleanRawType(rawType);
  if (!raw) {
    return 'other';
  }
  const segments = splitSegments(raw);
  if (!segments.length) {
    return 'other';
  }
  const segmentGroups = segments.map((segment) => {
    const [l1 = '', l2 = '', l3 = ''] = splitLevels(segment);
    if (!l1) {
      return 'other';
    }
    const baseGroup = ruleset.l1Map[l1];
    if (!baseGroup) {
      return 'other';
    }
    const overrideGroup = applyOverrides(l1, l2, l3, ruleset);
    return overrideGroup ?? baseGroup;
  });
  return pickByPriority(segmentGroups, ruleset.priority);
}

function normalizeRules(payload: unknown): TypeRules {
  if (!payload || typeof payload !== 'object') {
    return DEFAULT_RULES;
  }
  const maybeRules = payload as TypeRules;
  if (
    !Array.isArray(maybeRules.groups) ||
    !maybeRules.groups.length ||
    !maybeRules.l1Map ||
    typeof maybeRules.l1Map !== 'object' ||
    !Array.isArray(maybeRules.priority) ||
    !maybeRules.priority.length
  ) {
    return DEFAULT_RULES;
  }
  if (!Array.isArray(maybeRules.l2Overrides)) {
    maybeRules.l2Overrides = [];
  }
  return maybeRules;
}

function detectKey(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const key of keys) {
    if (records.some((record) => record && key in record)) {
      return key;
    }
  }
  return undefined;
}

function resolveValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim().length > 0) {
      return String(value).trim();
    }
  }
  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number.parseFloat(value);
  }
  return Number.NaN;
}

function toMapCoord(coord: [number, number]): [number, number] {
  if (coordConfig.poiCoordSys === coordConfig.mapCoordSys) {
    return coord;
  }
  return convertCoord(coord, coordConfig.poiCoordSys, coordConfig.mapCoordSys);
}

function addPoint(point: RawPoint) {
  if (!groupPoints.has(point.type_group)) {
    groupPoints.set(point.type_group, []);
  }
  groupPoints.get(point.type_group)?.push(point);
  typeCounts[point.type_group] = (typeCounts[point.type_group] ?? 0) + 1;
  const bbox = groupBboxes.get(point.type_group);
  if (!bbox) {
    groupBboxes.set(point.type_group, [point.lng, point.lat, point.lng, point.lat]);
    return;
  }
  bbox[0] = Math.min(bbox[0], point.lng);
  bbox[1] = Math.min(bbox[1], point.lat);
  bbox[2] = Math.max(bbox[2], point.lng);
  bbox[3] = Math.max(bbox[3], point.lat);
}

function buildPoints(rawData: unknown): void {
  groupPoints = new Map();
  groupIndexes.clear();
  isoIndexes.clear();
  groupBboxes = new Map();
  countGrids.clear();
  allIndex = null;
  typeCounts = {};

  if (
    rawData &&
    typeof rawData === 'object' &&
    (rawData as FeatureCollection).type === 'FeatureCollection' &&
    Array.isArray((rawData as FeatureCollection).features)
  ) {
    const list = (rawData as FeatureCollection<Point, Record<string, unknown>>).features ?? [];
    list.forEach((feature, index) => {
      if (!feature.geometry || feature.geometry.type !== 'Point') {
        return;
      }
      const coords = feature.geometry.coordinates as [number, number];
      const lonRaw = toNumber(coords[0]);
      const latRaw = toNumber(coords[1]);
      if (!Number.isFinite(lonRaw) || !Number.isFinite(latRaw)) {
        return;
      }
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const name = resolveValue(props, NAME_KEYS) ?? `POI-${index}`;
      const rawType = resolveValue(props, TYPE_KEYS) ?? '';
      const typeGroup = classifyType(rawType, rules);
      if (typeGroup === 'address') {
        return;
      }
      const [lng, lat] = toMapCoord([lonRaw, latRaw]);
      addPoint({
        id: String(props.id ?? props.ID ?? index),
        name,
        lng,
        lat,
        type_group: typeGroup
      });
    });
    return;
  }

  if (Array.isArray(rawData)) {
    const records = rawData.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
    if (!records.length) {
      return;
    }
    const lonKey = detectKey(records, LON_KEYS);
    const latKey = detectKey(records, LAT_KEYS);
    const nameKey = detectKey(records, NAME_KEYS);
    const typeKey = detectKey(records, TYPE_KEYS);
    if (!lonKey || !latKey) {
      return;
    }
    records.forEach((record, index) => {
      const lonRaw = toNumber(record[lonKey]);
      const latRaw = toNumber(record[latKey]);
      if (!Number.isFinite(lonRaw) || !Number.isFinite(latRaw)) {
        return;
      }
      const name =
        (nameKey ? String(record[nameKey] ?? '').trim() : '') || `POI-${index}`;
      const rawType = typeKey ? String(record[typeKey] ?? '').trim() : '';
      const typeGroup = classifyType(rawType, rules);
      if (typeGroup === 'address') {
        return;
      }
      const [lng, lat] = toMapCoord([lonRaw, latRaw]);
      addPoint({
        id: String(record.id ?? record.ID ?? index),
        name,
        lng,
        lat,
        type_group: typeGroup
      });
    });
  }
}

async function loadRules(rulesUrl: string) {
  if (!rulesUrl) {
    rules = DEFAULT_RULES;
    return;
  }
  try {
    const response = await fetch(rulesUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    rules = normalizeRules(data);
  } catch (error) {
    rules = DEFAULT_RULES;
  }
}

function ensureIndex(group: string) {
  if (groupIndexes.has(group)) {
    return;
  }
  const points = groupPoints.get(group) ?? [];
  const index = buildIndex(points);
  groupIndexes.set(group, index);
}

function buildIndex(points: RawPoint[]) {
  const features: PoiFeature[] = points.map((point) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    properties: {
      id: point.id,
      name: point.name,
      type_group: point.type_group
    }
  }));
  const index = new Supercluster<PoiProperties>({
    radius: 70,
    maxZoom: 18,
    minZoom: 0
  });
  index.load(features);
  return index;
}

function ensureAllIndex() {
  if (allIndex) {
    return;
  }
  const allPoints: RawPoint[] = [];
  groupPoints.forEach((list) => {
    list.forEach((point) => {
      allPoints.push(point);
    });
  });
  allIndex = buildIndex(allPoints);
}

function countClusters(
  index: Supercluster<PoiProperties>,
  bbox: Bbox,
  zoom: number = COUNT_ZOOM
): number {
  const clusters = index.getClusters(bbox, zoom) as ClusterFeature[];
  return clusters.reduce((sum, feature) => {
    const props = feature.properties as ClusterProperties | undefined;
    if (props?.cluster) {
      return sum + Number(props.point_count ?? 0);
    }
    return sum + 1;
  }, 0);
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function metersPerDegreeLat() {
  return 111320;
}

function metersPerDegreeLng(lat: number) {
  return 111320 * Math.cos(degreesToRadians(lat));
}

function metersToLatDelta(meters: number) {
  return meters / metersPerDegreeLat();
}

function metersToLngDelta(meters: number, lat: number) {
  const base = metersPerDegreeLng(lat);
  if (!Number.isFinite(base) || base === 0) {
    return meters / metersPerDegreeLat();
  }
  return meters / base;
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const radLat1 = degreesToRadians(lat1);
  const radLat2 = degreesToRadians(lat2);
  const deltaLat = radLat2 - radLat1;
  const deltaLng = degreesToRadians(lng2 - lng1);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(radLat1) * Math.cos(radLat2) * sinLng * sinLng;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function countWithinRadius(
  index: Supercluster<PoiProperties>,
  center: [number, number],
  radiusMeters: number
) {
  const [lng, lat] = center;
  const deltaLat = metersToLatDelta(radiusMeters);
  const deltaLng = metersToLngDelta(radiusMeters, lat);
  const bbox: Bbox = [lng - deltaLng, lat - deltaLat, lng + deltaLng, lat + deltaLat];
  return countClusters(index, bbox);
}

function nearestDistanceMeters(
  index: Supercluster<PoiProperties>,
  center: [number, number],
  maxRadiusMeters: number
): number | null {
  const steps = [400, 800, 1600, 3200, 6400];
  for (const radius of steps) {
    if (radius > maxRadiusMeters) break;
    const [lng, lat] = center;
    const deltaLat = metersToLatDelta(radius);
    const deltaLng = metersToLngDelta(radius, lat);
    const bbox: Bbox = [lng - deltaLng, lat - deltaLat, lng + deltaLng, lat + deltaLat];
    const clusters = index.getClusters(bbox, COUNT_ZOOM) as ClusterFeature[];
    if (!clusters.length) {
      continue;
    }
    let minDist = Infinity;
    clusters.forEach((feature) => {
      if (!feature.geometry || feature.geometry.type !== 'Point') {
        return;
      }
      const coords = feature.geometry.coordinates as [number, number];
      const dist = haversineMeters(center, coords);
      if (dist < minDist) {
        minDist = dist;
      }
    });
    if (Number.isFinite(minDist)) {
      return minDist;
    }
  }
  return null;
}

function normalizeMetric(
  value: number,
  min: number,
  max: number,
  invert = false
) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0.5;
  }
  if (max - min === 0) {
    return 0.5;
  }
  const raw = (value - min) / (max - min);
  const clamped = Math.min(Math.max(raw, 0), 1);
  return invert ? 1 - clamped : clamped;
}

function buildCandidateGrid(
  bbox: Bbox,
  spacingMeters: number,
  maxCandidates: number
) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const centerLat = (minLat + maxLat) / 2;
  const widthM = Math.abs(maxLng - minLng) * metersPerDegreeLng(centerLat);
  const heightM = Math.abs(maxLat - minLat) * metersPerDegreeLat();
  let spacing = spacingMeters;
  const estimate = Math.max(1, Math.floor(widthM / spacing)) * Math.max(1, Math.floor(heightM / spacing));
  if (estimate > maxCandidates) {
    spacing *= Math.sqrt(estimate / maxCandidates);
  }
  const latStep = metersToLatDelta(spacing);
  const lngStep = metersToLngDelta(spacing, centerLat);
  const candidates: Array<{ lng: number; lat: number }> = [];
  for (let lat = minLat + latStep / 2; lat <= maxLat; lat += latStep) {
    for (let lng = minLng + lngStep / 2; lng <= maxLng; lng += lngStep) {
      candidates.push({ lng, lat });
    }
  }
  if (!candidates.length) {
    candidates.push({ lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 });
  }
  if (candidates.length > maxCandidates) {
    const stride = Math.ceil(candidates.length / maxCandidates);
    return candidates.filter((_, index) => index % stride === 0).slice(0, maxCandidates);
  }
  return candidates;
}

function updateBbox(
  bbox: [number, number, number, number],
  coord: [number, number]
) {
  const [lng, lat] = coord;
  if (lng < bbox[0]) bbox[0] = lng;
  if (lat < bbox[1]) bbox[1] = lat;
  if (lng > bbox[2]) bbox[2] = lng;
  if (lat > bbox[3]) bbox[3] = lat;
}

function updateBboxFromCoords(
  coords: number[] | number[][] | number[][][] | number[][][][],
  bbox: [number, number, number, number]
) {
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    updateBbox(bbox, [coords[0], coords[1]]);
    return;
  }
  (coords as any[]).forEach((item) => updateBboxFromCoords(item, bbox));
}

function getPolygonBbox(
  geometry: Polygon | MultiPolygon
): [number, number, number, number] | null {
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  updateBboxFromCoords(geometry.coordinates as any, bbox);
  if (!Number.isFinite(bbox[0])) {
    return null;
  }
  return bbox;
}

function buildIsoIndex(
  group: string,
  polygon: IsoPolygonFeature,
  bbox: [number, number, number, number]
): RawPoint[] {
  const basePoints = groupPoints.get(group) ?? [];
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const candidates = basePoints.filter(
    (point) =>
      point.lng >= minLng &&
      point.lng <= maxLng &&
      point.lat >= minLat &&
      point.lat <= maxLat
  );
  const inside = candidates.filter((point) =>
    booleanPointInPolygon([point.lng, point.lat], polygon as any)
  );
  isoIndexes.set(group, buildIndex(inside));
  return inside;
}

function buildPolygonBboxes(polygons: IsoPolygonInput[]): Array<[number, number, number, number] | null> {
  return polygons.map((polygon) => {
    if (!polygon?.geometry) {
      return null;
    }
    const geometry = polygon.geometry;
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
      return null;
    }
    return getPolygonBbox(geometry);
  });
}

function buildCountGrid(points: RawPoint[]): CountGrid | null {
  if (!points.length) {
    return null;
  }
  let minLng = Infinity;
  let minLat = Infinity;
  points.forEach((point) => {
    minLng = Math.min(minLng, point.lng);
    minLat = Math.min(minLat, point.lat);
  });
  const cells = new Map<string, RawPoint[]>();
  points.forEach((point) => {
    const x = Math.floor((point.lng - minLng) / COUNT_GRID_CELL_DEG);
    const y = Math.floor((point.lat - minLat) / COUNT_GRID_CELL_DEG);
    const key = `${x}:${y}`;
    if (!cells.has(key)) {
      cells.set(key, []);
    }
    cells.get(key)?.push(point);
  });
  return { cellSize: COUNT_GRID_CELL_DEG, minLng, minLat, cells };
}

function queryCountGrid(grid: CountGrid, bbox: Bbox): RawPoint[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const x0 = Math.floor((minLng - grid.minLng) / grid.cellSize);
  const y0 = Math.floor((minLat - grid.minLat) / grid.cellSize);
  const x1 = Math.floor((maxLng - grid.minLng) / grid.cellSize);
  const y1 = Math.floor((maxLat - grid.minLat) / grid.cellSize);
  const results: RawPoint[] = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const key = `${x}:${y}`;
      const bucket = grid.cells.get(key);
      if (bucket?.length) {
        results.push(...bucket);
      }
    }
  }
  return results;
}

function polygonCoversBbox(polygon: IsoPolygonInput, bbox: Bbox): boolean {
  if (!polygon) {
    return false;
  }
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const corners: Array<[number, number]> = [
    [minLng, minLat],
    [minLng, maxLat],
    [maxLng, minLat],
    [maxLng, maxLat]
  ];
  return corners.every((coord) => booleanPointInPolygon(coord, polygon as any));
}

function countPointsInPolygonsByGrid(
  points: RawPoint[],
  grid: CountGrid,
  polygons: IsoPolygonInput[],
  bboxes: Array<Bbox | null>,
  groupBbox: Bbox
): number[] {
  return polygons.map((polygon, polygonIndex) => {
    const bbox = bboxes[polygonIndex];
    if (!polygon || !bbox) {
      return 0;
    }
    const [minLng, minLat, maxLng, maxLat] = bbox;
    if (
      maxLng < groupBbox[0] ||
      minLng > groupBbox[2] ||
      maxLat < groupBbox[1] ||
      minLat > groupBbox[3]
    ) {
      return 0;
    }
    if (polygonCoversBbox(polygon, groupBbox)) {
      return points.length;
    }
    const candidates = queryCountGrid(grid, bbox);
    let count = 0;
    candidates.forEach((point) => {
      if (
        point.lng < minLng ||
        point.lng > maxLng ||
        point.lat < minLat ||
        point.lat > maxLat
      ) {
        return;
      }
      if (booleanPointInPolygon([point.lng, point.lat], polygon as any)) {
        count += 1;
      }
    });
    return count;
  });
}

function clearIsochrones() {
  isoIndexes.clear();
}

function bboxToPolygon(minLng: number, minLat: number, maxLng: number, maxLat: number): PolygonFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat]
        ]
      ]
    },
    properties: {}
  };
}

function buildClusterPolygon(
  index: Supercluster<PoiProperties>,
  clusterId: number
): PolygonFeature | null {
  const leaves = index.getLeaves(clusterId, HULL_MAX_LEAVES, 0);
  if (!leaves.length) {
    return null;
  }
  const coords = leaves.map((leaf) => leaf.geometry.coordinates as [number, number]);
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  coords.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  });
  if (HULL_MODE === 'hull' && coords.length >= 3) {
    const hull = convex(featureCollection(coords.map((c) => turfPoint(c))));
    if (hull) {
      return hull as PolygonFeature;
    }
  }
  return bboxToPolygon(minLng, minLat, maxLng, maxLat);
}

type IncomingMessage =
  | { type: 'INIT'; payload: { poiUrl: string; rulesUrl: string; coordSysConfig: CoordSysConfig } }
  | { type: 'BUILD_INDEX'; payload: { groups: string[] } }
  | { type: 'BBOX_STATS'; payload: { bbox: Bbox; requestId: number } }
  | {
      type: 'SITE_SELECT';
      payload: {
        bbox: Bbox;
        targetGroupId: string;
        topN: number;
        maxCandidates?: number;
        gridSpacingMeters?: number;
        requestId: number;
      };
    }
  | {
      type: 'QUERY';
      payload: {
        bbox: [number, number, number, number];
        zoom: number;
        groups: string[];
        includeHull?: boolean;
        requestId: number;
        useIso?: boolean;
      };
    }
  | {
      type: 'COUNT_IN_POLYGONS';
      payload: {
        polygons: IsoPolygonInput[];
        groups: string[];
        requestId: number;
      };
    }
  | { type: 'EXPAND'; payload: { group: string; clusterId: number; requestId: number; useIso?: boolean } }
  | { type: 'APPLY_ISOCHRONE'; payload: { polygon: IsoPolygonFeature; groups: string[]; requestId: number } }
  | { type: 'CLEAR_ISOCHRONE' };

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  try {
    // Use a discriminated switch to keep payload access type-safe.
    switch (message.type) {
      case 'INIT': {
        const { poiUrl, rulesUrl, coordSysConfig: incoming } = message.payload;
        coordConfig = {
          poiCoordSys: normalizeCoordSys(incoming.poiCoordSys, 'WGS84'),
          mapCoordSys: normalizeCoordSys(incoming.mapCoordSys, 'WGS84')
        };
        await loadRules(rulesUrl);
        const response = await fetch(poiUrl, { cache: 'no-cache' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const rawData = await response.json();
        buildPoints(rawData);
        self.postMessage({
          type: 'INIT_DONE',
          payload: {
            total: Object.values(typeCounts).reduce((sum, value) => sum + value, 0),
            typeCounts,
            rulesMeta: rules.meta ?? null
          }
        });
        logWorker('init_done', {
          groups: Object.keys(typeCounts).length,
          total: Object.values(typeCounts).reduce((sum, value) => sum + value, 0)
        });
        return;
      }
      case 'BUILD_INDEX': {
        const groups = message.payload.groups.filter((group) => group && group !== 'address');
        groups.forEach((group) => ensureIndex(group));
        self.postMessage({
          type: 'INDEX_READY',
          payload: { groups }
        });
        logWorker('index_ready', { groups });
        return;
      }
      case 'BBOX_STATS': {
        const { bbox, requestId } = message.payload;
        const byGroup: Record<string, number> = {};
        let poiTotal = 0;
        const groups = Array.from(groupPoints.keys()).filter(
          (group) => group && group !== 'address'
        );
        groups.forEach((group) => {
          ensureIndex(group);
          const index = groupIndexes.get(group);
          if (!index) return;
          const count = countClusters(index, bbox);
          byGroup[group] = count;
          poiTotal += count;
        });
        self.postMessage({
          type: 'BBOX_STATS_RESULT',
          payload: { requestId, poiTotal, byGroup }
        });
        logWorker('bbox_stats', { requestId, groups: groups.length, poiTotal });
        return;
      }
      case 'SITE_SELECT': {
        const {
          bbox,
          targetGroupId,
          topN,
          maxCandidates = SITE_DEFAULTS.maxCandidates,
          gridSpacingMeters = SITE_DEFAULTS.gridSpacingMeters,
          requestId
        } = message.payload;
        if (!targetGroupId || targetGroupId === 'address') {
          self.postMessage({
            type: 'SITE_SELECT_RESULT',
            payload: { requestId, results: [] }
          });
          return;
        }
        ensureIndex(targetGroupId);
        const targetIndex = groupIndexes.get(targetGroupId);
        if (!targetIndex) {
          self.postMessage({
            type: 'SITE_SELECT_RESULT',
            payload: { requestId, results: [] }
          });
          return;
        }
        ensureAllIndex();
        const totalIndex = allIndex;
        let transportIndex: Supercluster<PoiProperties> | null = null;
        if (groupPoints.has('transport')) {
          ensureIndex('transport');
          transportIndex = groupIndexes.get('transport') ?? null;
        }
        const synergyGroups = SYNERGY_GROUPS.filter((group) => groupPoints.has(group));
        synergyGroups.forEach((group) => ensureIndex(group));
        const synergyIndexes = synergyGroups
          .map((group) => groupIndexes.get(group))
          .filter((index): index is Supercluster<PoiProperties> => Boolean(index));

        const candidates = buildCandidateGrid(bbox, gridSpacingMeters, maxCandidates);
        if (!candidates.length) {
          self.postMessage({
            type: 'SITE_SELECT_RESULT',
            payload: { requestId, results: [] }
          });
          return;
        }
        const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
        const raw = candidates.map((candidate) => {
          const coord: [number, number] = [candidate.lng, candidate.lat];
          const competitionCount = countWithinRadius(
            targetIndex,
            coord,
            SITE_DEFAULTS.radiusCompetition
          );
          const demandTotal = totalIndex
            ? countWithinRadius(totalIndex, coord, SITE_DEFAULTS.radiusDemand)
            : competitionCount;
          const demandTarget = countWithinRadius(
            targetIndex,
            coord,
            SITE_DEFAULTS.radiusDemand
          );
          const demandCount = Math.max(demandTotal - demandTarget, 0);
          const synergyCount = synergyIndexes.reduce(
            (sum, index) =>
              sum + countWithinRadius(index, coord, SITE_DEFAULTS.radiusSynergy),
            0
          );
          const accessSource = transportIndex ?? totalIndex;
          const accessDistance = accessSource
            ? nearestDistanceMeters(accessSource, coord, SITE_DEFAULTS.radiusAccessMax) ??
              SITE_DEFAULTS.radiusAccessMax
            : SITE_DEFAULTS.radiusAccessMax;
          const centerDistance = haversineMeters(coord, center);
          return {
            coord,
            competitionCount,
            demandCount,
            synergyCount,
            accessDistance,
            centerDistance
          };
        });

        const compValues = raw.map((item) => item.competitionCount);
        const demandValues = raw.map((item) => item.demandCount);
        const synergyValues = raw.map((item) => item.synergyCount);
        const accessValues = raw.map((item) => item.accessDistance);
        const centerValues = raw.map((item) => item.centerDistance);
        const minMax = (values: number[]) => ({
          min: Math.min(...values),
          max: Math.max(...values)
        });
        const compExtent = minMax(compValues);
        const demandExtent = minMax(demandValues);
        const synergyExtent = minMax(synergyValues);
        const accessExtent = minMax(accessValues);
        const centerExtent = minMax(centerValues);

        const results: SiteCandidate[] = raw.map((item) => {
          const demand = normalizeMetric(
            item.demandCount,
            demandExtent.min,
            demandExtent.max
          );
          const competition = normalizeMetric(
            item.competitionCount,
            compExtent.min,
            compExtent.max,
            true
          );
          const synergy = normalizeMetric(
            item.synergyCount,
            synergyExtent.min,
            synergyExtent.max
          );
          const access = normalizeMetric(
            item.accessDistance,
            accessExtent.min,
            accessExtent.max,
            true
          );
          const centerScore = normalizeMetric(
            item.centerDistance,
            centerExtent.min,
            centerExtent.max,
            true
          );
          const total =
            demand * SITE_WEIGHTS.demand +
            access * SITE_WEIGHTS.access +
            competition * SITE_WEIGHTS.competition +
            synergy * SITE_WEIGHTS.synergy +
            centerScore * SITE_WEIGHTS.center;
          return {
            lng: item.coord[0],
            lat: item.coord[1],
            total,
            metrics: {
              demand,
              access,
              competition,
              synergy,
              center: centerScore
            },
            debug: {
              demandCount: item.demandCount,
              competitionCount: item.competitionCount,
              synergyCount: item.synergyCount,
              accessMeters: item.accessDistance,
              centerMeters: item.centerDistance
            }
          };
        });

        results.sort((a, b) => b.total - a.total);
        self.postMessage({
          type: 'SITE_SELECT_RESULT',
          payload: { requestId, results: results.slice(0, Math.max(1, topN)) }
        });
        logWorker('site_select', {
          requestId,
          candidates: candidates.length,
          results: Math.min(results.length, topN)
        });
        return;
      }
      case 'QUERY': {
        const { bbox, zoom, groups, requestId, includeHull, useIso } = message.payload;
        const shouldIncludeHull = Boolean(includeHull);
        const useIsoIndex = Boolean(useIso);
        logWorker('query_recv', {
          requestId,
          bbox,
          zoom,
          groups,
          includeHull: shouldIncludeHull,
          useIso: useIsoIndex
        });
        const results: Record<string, { points: FeatureCollection<Point>; hulls: FeatureCollection<Polygon> }> = {};
        const counts: Record<string, { pointsCount: number; clustersCount: number }> | undefined = DEV_LOG
          ? {}
          : undefined;
        groups
          .filter((group) => group && group !== 'address')
          .forEach((group) => {
            if (!useIsoIndex) {
              ensureIndex(group);
            }
            const index = useIsoIndex ? isoIndexes.get(group) : groupIndexes.get(group);
            if (!index) {
              results[group] = {
                points: { type: 'FeatureCollection', features: [] },
                hulls: { type: 'FeatureCollection', features: [] }
              };
              if (counts) {
                counts[group] = { pointsCount: 0, clustersCount: 0 };
              }
              return;
            }
            const clusters = index.getClusters(bbox, zoom) as ClusterFeature[];
            if (counts) {
              const clustersCount = clusters.filter(
                (feature) => Boolean((feature.properties as ClusterProperties | undefined)?.cluster)
              ).length;
              const pointsCount = clusters.length - clustersCount;
              counts[group] = { pointsCount, clustersCount };
            }
            const hulls: PolygonFeature[] = [];
            if (shouldIncludeHull && zoom <= HULL_MAX_ZOOM) {
              clusters.forEach((feature) => {
                const props = feature.properties as ClusterProperties | undefined;
                if (!props?.cluster) return;
                const count = Number(props.point_count ?? 0);
                if (count < HULL_MIN_COUNT) return;
                const clusterId = Number((props as { cluster_id?: number }).cluster_id);
                if (!Number.isFinite(clusterId)) return;
                const polygon = buildClusterPolygon(index, clusterId);
                if (!polygon) return;
                polygon.properties = {
                  group,
                  cluster_id: clusterId,
                  point_count: count
                };
                hulls.push(polygon);
              });
            }
            results[group] = {
              points: { type: 'FeatureCollection', features: clusters as Feature<Point, PoiProperties>[] },
              hulls: { type: 'FeatureCollection', features: hulls }
            };
          });
        self.postMessage({
          type: 'QUERY_RESULT',
          payload: { requestId, results }
        });
        logWorker('query_result', { requestId, groups: Object.keys(results).length, counts });
        return;
      }
      case 'COUNT_IN_POLYGONS': {
        const { polygons, groups, requestId } = message.payload;
        const validGroups = groups.filter((group) => group && group !== 'address');
        const bboxes = buildPolygonBboxes(polygons);
        const counts: Record<string, number[]> = {};
        validGroups.forEach((group) => {
          const points = groupPoints.get(group) ?? [];
          if (!points.length) {
            counts[group] = polygons.map(() => 0);
            return;
          }
          let grid = countGrids.get(group);
          if (!grid) {
            grid = buildCountGrid(points) ?? undefined;
            if (grid) {
              countGrids.set(group, grid);
            }
          }
          const groupBbox = groupBboxes.get(group);
          if (!grid || !groupBbox) {
            counts[group] = polygons.map(() => 0);
            return;
          }
          counts[group] = countPointsInPolygonsByGrid(
            points,
            grid,
            polygons,
            bboxes,
            groupBbox
          );
        });
        self.postMessage({
          type: 'POLYGON_COUNTS',
          payload: { requestId, counts }
        });
        return;
      }
      case 'EXPAND': {
        const { group, clusterId, requestId, useIso } = message.payload;
        const useIsoIndex = Boolean(useIso);
        if (!useIsoIndex) {
          ensureIndex(group);
        }
        const index = useIsoIndex ? isoIndexes.get(group) : groupIndexes.get(group);
        const zoom = index ? index.getClusterExpansionZoom(clusterId) : null;
        self.postMessage({
          type: 'EXPAND_RESULT',
          payload: { requestId, zoom }
        });
        return;
      }
      case 'APPLY_ISOCHRONE': {
        const { polygon, groups, requestId } = message.payload;
        const geometry = polygon?.geometry;
        if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
          clearIsochrones();
          self.postMessage({
            type: 'ISO_INDEX_READY',
            payload: { requestId, countsByGroup: {}, builtGroups: [], tookMs: 0 }
          });
          return;
        }
        const bbox = getPolygonBbox(geometry);
        if (!bbox) {
          clearIsochrones();
          self.postMessage({
            type: 'ISO_INDEX_READY',
            payload: { requestId, countsByGroup: {}, builtGroups: [], tookMs: 0 }
          });
          return;
        }
        const countsByGroup: Record<string, number> = {};
        const pointsByGroup: Record<string, RawPoint[]> = {};
        const builtGroups: string[] = [];
        const startedAt = Date.now();
        groups
          .filter((group) => group && group !== 'address')
          .forEach((group) => {
            const inside = buildIsoIndex(group, polygon, bbox);
            pointsByGroup[group] = inside;
            countsByGroup[group] = inside.length;
            builtGroups.push(group);
          });
        self.postMessage({
          type: 'ISO_INDEX_READY',
          payload: {
            requestId,
            countsByGroup,
            pointsByGroup,
            builtGroups,
            tookMs: Date.now() - startedAt
          }
        });
        logWorker('iso_index_ready', {
          requestId,
          groups: builtGroups.length,
          tookMs: Date.now() - startedAt
        });
        return;
      }
      case 'CLEAR_ISOCHRONE': {
        clearIsochrones();
        self.postMessage({ type: 'ISO_CLEARED' });
        logWorker('iso_cleared');
        return;
      }
      default:
        return;
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    const sourceType = message?.type ?? 'UNKNOWN';
    self.postMessage({
      type: 'ERROR',
      payload: { message: messageText, stack, sourceType }
    });
    if (DEV_LOG) {
      console.error('[poi-worker] error', { sourceType, message: messageText, stack });
    }
  }
};
