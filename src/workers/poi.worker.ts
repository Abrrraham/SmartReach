import Supercluster from 'supercluster';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { convertCoord, normalizeCoordSys, type CoordSys } from '../utils/coord';

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

type ClusterProperties = Supercluster.ClusterProperties & Record<string, unknown>;
type PoiFeature = Feature<Point, PoiProperties>;
type ClusterFeature = Feature<Point, PoiProperties | ClusterProperties>;

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
    { id: 'address', label: '地名地址' },
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
    地名地址信息: 'address',
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
    'address',
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

let allFeatures: PoiFeature[] = [];
let typeCounts: Record<string, number> = {};
let rules: TypeRules = DEFAULT_RULES;
let coordConfig: CoordSysConfig = {
  poiCoordSys: 'WGS84',
  mapCoordSys: 'WGS84'
};
let clusterCache = new Map<string, Supercluster<PoiProperties>>();
let indexCounts = new Map<string, number>();
let activeIndexKey = '';
let activeIndex: Supercluster<PoiProperties> | null = null;
let activeIndexCount = 0;
const MAX_DETAIL_POINTS = 200000;

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

function applyOverrides(l1: string, l2: string, l3: string, rules: TypeRules) {
  for (const override of rules.l2Overrides ?? []) {
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

function classifyType(rawType: string, rules: TypeRules): string {
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
    const baseGroup = rules.l1Map[l1];
    if (!baseGroup) {
      return 'other';
    }
    const overrideGroup = applyOverrides(l1, l2, l3, rules);
    return overrideGroup ?? baseGroup;
  });
  return pickByPriority(segmentGroups, rules.priority);
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

function buildFeatures(rawData: unknown): PoiFeature[] {
  const features: PoiFeature[] = [];
  const counts: Record<string, number> = {};
  rules.groups.forEach((group) => {
    counts[group.id] = 0;
  });

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
      const [lng, lat] = toMapCoord([lonRaw, latRaw]);
      const poiProps: PoiProperties = {
        id: String(props.id ?? props.ID ?? index),
        name,
        type_group: typeGroup
      };
      counts[typeGroup] = (counts[typeGroup] ?? 0) + 1;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: poiProps
      });
    });
    typeCounts = counts;
    return features;
  }

  if (Array.isArray(rawData)) {
    const records = rawData.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
    if (!records.length) {
      typeCounts = counts;
      return features;
    }
    const lonKey = detectKey(records, LON_KEYS);
    const latKey = detectKey(records, LAT_KEYS);
    const nameKey = detectKey(records, NAME_KEYS);
    const typeKey = detectKey(records, TYPE_KEYS);
    if (!lonKey || !latKey) {
      typeCounts = counts;
      return features;
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
      const [lng, lat] = toMapCoord([lonRaw, latRaw]);
      const poiProps: PoiProperties = {
        id: String(record.id ?? record.ID ?? index),
        name,
        type_group: typeGroup
      };
      counts[typeGroup] = (counts[typeGroup] ?? 0) + 1;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: poiProps
      });
    });
    typeCounts = counts;
    return features;
  }

  typeCounts = counts;
  return features;
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

function buildIndex(selectedGroups: string[]) {
  const normalized = selectedGroups.filter(Boolean).sort();
  const key = normalized.join('|');
  if (!key) {
    activeIndexKey = '';
    activeIndex = null;
    activeIndexCount = 0;
    return { usedCount: 0, selectedGroups: [] };
  }

  if (clusterCache.has(key)) {
    activeIndexKey = key;
    activeIndex = clusterCache.get(key) ?? null;
    activeIndexCount = indexCounts.get(key) ?? 0;
    return { usedCount: activeIndexCount, selectedGroups: normalized };
  }

  const index = new Supercluster<PoiProperties>({
    radius: 70,
    maxZoom: 18,
    minZoom: 0
  });
  const filtered = allFeatures.filter((feature) =>
    normalized.includes(feature.properties?.type_group ?? 'other')
  );
  index.load(filtered);
  clusterCache.set(key, index);
  indexCounts.set(key, filtered.length);
  activeIndexKey = key;
  activeIndex = index;
  activeIndexCount = filtered.length;
  return { usedCount: filtered.length, selectedGroups: normalized };
}

function queryClusters(bbox: [number, number, number, number], zoom: number) {
  if (!activeIndex) {
    return { type: 'FeatureCollection', features: [] } as FeatureCollection<Point, PoiProperties>;
  }
  let clusters = activeIndex.getClusters(bbox, zoom) as ClusterFeature[];
  if (activeIndexCount > MAX_DETAIL_POINTS) {
    clusters = clusters.filter((feature) =>
      Boolean((feature.properties as ClusterProperties | undefined)?.cluster)
    );
  }
  if (clusters.length > 8000) {
    clusters = activeIndex.getClusters(bbox, Math.max(0, zoom - 2)) as ClusterFeature[];
  }
  if (clusters.length > 8000) {
    clusters = clusters.filter((feature) => Boolean((feature.properties as ClusterProperties | undefined)?.cluster));
  }
  return {
    type: 'FeatureCollection',
    features: clusters
  } as FeatureCollection<Point, PoiProperties | ClusterProperties>;
}

type IncomingMessage =
  | { type: 'INIT'; payload: { poiUrl: string; rulesUrl: string; coordSysConfig: CoordSysConfig } }
  | { type: 'BUILD_INDEX'; payload: { selectedGroups: string[] } }
  | { type: 'QUERY'; payload: { bbox: [number, number, number, number]; zoom: number; requestId: number } };

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
      allFeatures = buildFeatures(rawData);
      self.postMessage({
        type: 'INIT_DONE',
        payload: {
          total: allFeatures.length,
          typeCounts,
          rulesMeta: rules.meta ?? null
        }
      });
      return;
    }

    if (type === 'BUILD_INDEX') {
      const { selectedGroups } = payload;
      const result = buildIndex(selectedGroups);
      self.postMessage({
        type: 'INDEX_READY',
        payload: result
      });
      return;
    }

    if (type === 'QUERY') {
      const { bbox, zoom, requestId } = payload;
      const fc = queryClusters(bbox, zoom);
      self.postMessage({
        type: 'QUERY_RESULT',
        payload: { fc, requestId, indexKey: activeIndexKey }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    self.postMessage({ type: 'ERROR', payload: { message } });
  }
};
