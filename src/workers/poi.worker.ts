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
let isoIndexes = new Map<string, Supercluster<PoiProperties>>();
let typeCounts: Record<string, number> = {};

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
}

function buildPoints(rawData: unknown): void {
  groupPoints = new Map();
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
  | { type: 'EXPAND'; payload: { group: string; clusterId: number; requestId: number; useIso?: boolean } }
  | { type: 'APPLY_ISOCHRONE'; payload: { polygon: IsoPolygonFeature; groups: string[]; requestId: number } }
  | { type: 'CLEAR_ISOCHRONE' };

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const { type, payload } = event.data;
  try {
    if (type === 'INIT') {
      const { poiUrl, rulesUrl, coordSysConfig: incoming } = payload;
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

    if (type === 'BUILD_INDEX') {
      const groups = payload.groups.filter((group) => group && group !== 'address');
      groups.forEach((group) => ensureIndex(group));
      self.postMessage({
        type: 'INDEX_READY',
        payload: { groups }
      });
      logWorker('index_ready', { groups });
      return;
    }

    if (type === 'QUERY') {
      const { bbox, zoom, groups, requestId, includeHull, useIso } = payload;
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

    if (type === 'EXPAND') {
      const { group, clusterId, requestId, useIso } = payload;
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

    if (type === 'APPLY_ISOCHRONE') {
      const { polygon, groups, requestId } = payload;
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

    if (type === 'CLEAR_ISOCHRONE') {
      clearIsochrones();
      self.postMessage({ type: 'ISO_CLEARED' });
      logWorker('iso_cleared');
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    self.postMessage({ type: 'ERROR', payload: { message } });
  }
};
