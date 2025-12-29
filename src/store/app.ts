import { computed, ref, watch, watchEffect } from 'vue';
import { defineStore } from 'pinia';
import { saveAs } from 'file-saver';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';
import type { POI } from '../types/poi';
import {
  bboxOfNanjing,
  withinIsochrone,
  scoring,
  type CandidateWithMetrics,
  type SitingWeights,
  type TravelProfile
} from '../utils/spatial';
import {
  convertCoord,
  gcj02ToWgs84,
  normalizeCoordSys,
  transformGeoJSON,
  transformGeoJSONCoordinates,
  wgs84ToGcj02,
  type CoordSys
} from '../utils/coord';
import { GROUP_COLORS, GROUP_LABELS, GROUP_ORDER } from '../utils/poiGroups';
import {
  directionsGeojson as fetchDirectionsGeojson,
  isochrones as fetchIsochrones
} from '../services/ors';

interface MapState {
  center: [number, number];
  zoom: number;
  styleUrl?: string;
}

interface FilterState {
  travelMode: TravelProfile;
  times: number[];
}

interface IsochroneState {
  origin?: { lng: number; lat: number };
  profile: TravelProfile;
  rangesMin: number[];
  active: boolean;
  dirty: boolean;
  loading: boolean;
  error?: string;
  isFallback: boolean;
  geojson?: FeatureCollection;
}

interface IsoEngineState {
  active: boolean;
  origin?: { lng: number; lat: number };
  polygon?: Feature<Polygon | MultiPolygon>;
  indexing: boolean;
  indexReady: boolean;
  countsByGroup: Record<string, number>;
  pointsByGroup: Record<string, POI[]>;
  lastIsoRequestId: number;
}

interface DataState {
  poisInIsochrone: POI[];
  candidates: CandidateWithMetrics[];
}

interface UiState {
  activeIsoGroupId: string | null;
  isoListPageSize: number;
  isoListPage: number;
  isoPickArmed: boolean;
  accessPickArmed: boolean;
  bboxPickArmed: boolean;
  mapHint: string | null;
  overlay: OverlayState | null;
  poiBlockingLoadingVisible: boolean;
  rightTab: 'iso' | 'site';
  rightTabLocked: boolean;
}

interface PoiEngineState {
  prefetchStarted: boolean;
  loadingPois: boolean;
  buildingIndex: boolean;
  queryLoading: boolean;
  ready: boolean;
  mapReady: boolean;
  indexReady: boolean;
  initialRendered: boolean;
  showClusterExtent: boolean;
  error?: string;
  typeCounts: Record<string, number>;
  selectedGroups: string[];
  poiByGroup: Record<string, FeatureCollection<Point, Record<string, unknown>>>;
  hullByGroup: Record<string, FeatureCollection<Polygon, Record<string, unknown>>>;
  viewportPoints: POI[];
  rulesMeta?: Record<string, unknown> | null;
  lastViewport?: { bbox: [number, number, number, number]; zoom: number } | null;
  pendingViewport?: { bbox: [number, number, number, number]; zoom: number } | null;
}

interface AnalysisState {
  isochrone?: FeatureCollection;
  sitingWeights: SitingWeights;
}

interface SiteSelectionResult {
  rank: number;
  lng: number;
  lat: number;
  total: number;
  metrics: {
    demand: number;
    access: number;
    competition: number;
    synergy: number;
    center: number;
  };
  address?: string;
  debug?: Record<string, number>;
}

interface SiteEngineState {
  targetGroupId: string | null;
  bbox: [number, number, number, number] | null;
  bboxStats: {
    areaKm2: number;
    widthKm: number;
    heightKm: number;
    poiTotal: number;
    byGroup?: Record<string, number>;
  } | null;
  constraints: { maxAreaKm2: number; maxPoi: number };
  running: boolean;
  lastRunId: number;
  error?: string;
  results: SiteSelectionResult[];
  expandedRanks: Record<number, boolean>;
  selectedRank: number | null;
}

interface RouteState {
  active: boolean;
  loading: boolean;
  profile: TravelProfile;
  start?: { lng: number; lat: number };
  end?: { lng: number; lat: number };
  isFallback: boolean;
  geojson?: FeatureCollection;
  summary?: { distance: number; duration: number };
  steps?: Array<{ instruction: string; distance: number; duration: number }>;
  error?: string;
}

type AccessibilityLevel = '很高' | '高' | '中' | '低' | '很低';

interface AccessibilityBaseline {
  version: number;
  city: string;
  thresholdsMin: number[];
  profile?: TravelProfile;
  coreGroups: string[];
  categoryMean: Record<string, number[]>;
  indexMean: number[];
  ratingBreaks: { p20: number; p40: number; p60: number; p80: number };
}

interface AccessibilityState {
  active: boolean;
  loading: boolean;
  error?: string;
  notice?: string;
  origin?: { lng: number; lat: number };
  profile: TravelProfile;
  thresholdsMin: number[];
  coreGroups: string[];
  baseline?: AccessibilityBaseline;
  baselineLoadedFromFile: boolean;
  baselineProfileMatch: boolean;
  counts?: Record<string, number[]>;
  index?: number[];
  cityIndex?: number[];
  rating?: { level: AccessibilityLevel; score: number };
  dirty: boolean;
  isFallback: boolean;
}

type OverlayType = 'loading' | 'error' | 'info';

interface OverlayState {
  type: OverlayType;
  message: string;
  detail?: string;
}

const POI_URL = (import.meta.env.VITE_POI_URL as string | undefined) ?? '/data/nanjing_poi.json';
const RULES_URL = '/data/type_rules.generated.json';
const BASEMAP_PROVIDER = (
  (import.meta.env.VITE_BASEMAP_PROVIDER as string | undefined) ?? 'amap'
).toLowerCase();
const MAP_COORD_SYS: CoordSys = normalizeCoordSys(
  import.meta.env.VITE_COORD_SYS as string | undefined,
  BASEMAP_PROVIDER === 'osm' ? 'WGS84' : 'GCJ02'
);
const POI_COORD_SYS: CoordSys = normalizeCoordSys(
  import.meta.env.VITE_POI_COORD_SYS as string | undefined,
  'WGS84'
);
const AMAP_KEY = (import.meta.env.VITE_AMAP_KEY as string | undefined) ?? '';

const DEFAULT_CENTER = (() => {
  const raw = (import.meta.env.VITE_DEFAULT_CENTER as string | undefined) ?? '118.796,32.060';
  const [lon, lat] = raw.split(',').map((value) => Number.parseFloat(value.trim()));
  return [Number.isFinite(lon) ? lon : 118.796, Number.isFinite(lat) ? lat : 32.06] as [
    number,
    number
  ];
})();

const DEFAULT_ZOOM = Number.parseFloat((import.meta.env.VITE_DEFAULT_ZOOM as string) ?? '11');
const DEFAULT_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
const ISO_CACHE_TTL_MS = 5 * 60 * 1000;
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;

const INITIAL_WEIGHTS: SitingWeights = {
  demand: 1,
  accessibility: 1,
  density: 1,
  constraint: 1
};

const ACCESS_DEBUG =
  import.meta.env.DEV && (import.meta.env.VITE_DEBUG_ACCESS as string | undefined) === '1';
const ACCESS_WORKER_TIMEOUT_MS = 12 * 1000;
const ACCESS_POI_WAIT_TIMEOUT_MS = 15 * 1000;
const BASE_URL = (import.meta.env.BASE_URL as string | undefined) ?? '/';
const ACCESS_BASELINE_URL = BASE_URL.endsWith('/')
  ? `${BASE_URL}data/nanjing_access_baseline.json`
  : `${BASE_URL}/data/nanjing_access_baseline.json`;

const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const ACCESS_CORE_GROUPS = [
  'shopping',
  'transport',
  'medical',
  'education_culture',
  'entertainment_sports',
  'public_facility'
];
const ACCESS_BASELINE_FALLBACK: AccessibilityBaseline = {
  version: 1,
  city: '南京市',
  thresholdsMin: [1, 15, 30, 45, 60],
  profile: 'foot-walking',
  coreGroups: ACCESS_CORE_GROUPS,
  categoryMean: {
    shopping: [20, 1430, 2800, 4000, 5000],
    transport: [15, 1030, 2060, 3100, 4000],
    medical: [3, 200, 470, 700, 930],
    education_culture: [4, 266, 600, 860, 1130],
    entertainment_sports: [5, 316, 700, 1010, 1300],
    public_facility: [3, 163, 366, 550, 733]
  },
  indexMean: [0.9, 1.0, 1.08, 1.15, 1.2],
  ratingBreaks: { p20: 0.85, p40: 1.0, p60: 1.15, p80: 1.3 }
};

export const useAppStore = defineStore('app', () => {
  const map = ref<MapState>({
    center: DEFAULT_CENTER,
    zoom: Number.isFinite(DEFAULT_ZOOM) ? DEFAULT_ZOOM : 11,
    styleUrl: DEFAULT_STYLE_URL ?? undefined
  });

  const filters = ref<FilterState>({
    travelMode: 'foot-walking',
    times: [300, 600, 900]
  });

  const iso = ref<IsochroneState>({
    origin: undefined,
    profile: 'foot-walking',
    rangesMin: [5, 10, 15],
    active: false,
    dirty: false,
    loading: false,
    error: undefined,
    isFallback: false,
    geojson: undefined
  });

  const isoEngine = ref<IsoEngineState>({
    active: false,
    origin: undefined,
    polygon: undefined,
    indexing: false,
    indexReady: false,
    countsByGroup: {},
    pointsByGroup: {},
    lastIsoRequestId: 0
  });

  const data = ref<DataState>({
    poisInIsochrone: [],
    candidates: []
  });

  const ui = ref<UiState>({
    activeIsoGroupId: null,
    isoListPageSize: 200,
    isoListPage: 1,
    isoPickArmed: false,
    accessPickArmed: false,
    bboxPickArmed: false,
    mapHint: null,
    overlay: null,
    poiBlockingLoadingVisible: false,
    rightTab: 'iso',
    rightTabLocked: false
  });

  const poiEngine = ref<PoiEngineState>({
    prefetchStarted: false,
    loadingPois: false,
    buildingIndex: false,
    queryLoading: false,
    ready: false,
    mapReady: false,
    indexReady: false,
    initialRendered: false,
    showClusterExtent: false,
    error: undefined,
    typeCounts: {},
    selectedGroups: [],
    poiByGroup: {},
    hullByGroup: {},
    viewportPoints: [],
    rulesMeta: null,
    lastViewport: null,
    pendingViewport: null
  });

  const analysis = ref<AnalysisState>({
    isochrone: undefined,
    sitingWeights: { ...INITIAL_WEIGHTS }
  });


  const siteEngine = ref<SiteEngineState>({
    targetGroupId: null,
    bbox: null,
    bboxStats: null,
    constraints: { maxAreaKm2: 200, maxPoi: 80000 },
    running: false,
    lastRunId: 0,
    error: undefined,
    results: [],
    expandedRanks: {},
    selectedRank: null
  });

  const route = ref<RouteState>({
    active: false,
    loading: false,
    profile: 'foot-walking',
    start: undefined,
    end: undefined,
    isFallback: false,
    geojson: undefined,
    summary: undefined,
    steps: undefined,
    error: undefined
  });

  const accessibility = ref<AccessibilityState>({
    active: false,
    loading: false,
    error: undefined,
    notice: undefined,
    origin: undefined,
    profile: 'foot-walking',
    thresholdsMin: ACCESS_BASELINE_FALLBACK.thresholdsMin,
    coreGroups: ACCESS_CORE_GROUPS,
    baseline: undefined,
    baselineLoadedFromFile: false,
    baselineProfileMatch: true,
    counts: undefined,
    index: undefined,
    cityIndex: undefined,
    rating: undefined,
    dirty: false,
    isFallback: false
  });

  const nanjingBounds = computed(() => bboxOfNanjing());
  const visiblePoisInIsochrone = computed(() => data.value.poisInIsochrone);
  const isoGroupStatsSorted = computed(() => {
    if (!isoEngine.value.active) {
      return [];
    }
    const selected = new Set(poiEngine.value.selectedGroups);
    const stats = Object.entries(isoEngine.value.countsByGroup)
      .filter(([groupId, count]) => selected.has(groupId) && Number(count) > 0)
      .map(([groupId, count]) => ({
        id: groupId,
        label: GROUP_LABELS[groupId] ?? groupId,
        count: Number(count) || 0,
        color: GROUP_COLORS[groupId] ?? GROUP_COLORS.other ?? '#64748b',
        order: GROUP_ORDER.indexOf(groupId)
      }))
      .sort((a, b) => {
        const orderA = a.order === -1 ? Number.MAX_SAFE_INTEGER : a.order;
        const orderB = b.order === -1 ? Number.MAX_SAFE_INTEGER : b.order;
        return orderA - orderB;
      });
    return stats;
  });
  const isoPoisByGroup = computed<Record<string, POI[]>>(() => {
    if (!isoEngine.value.active) {
      return {};
    }
    const grouped: Record<string, POI[]> = {};
    data.value.poisInIsochrone.forEach((poi) => {
      const groupId = poi.type_group;
      if (!groupId) return;
      if (!grouped[groupId]) {
        grouped[groupId] = [];
      }
      grouped[groupId].push(poi);
    });
    return grouped;
  });
  const activeIsoPois = computed(() => {
    const groupId = ui.value.activeIsoGroupId;
    if (!groupId) {
      return [];
    }
    return isoPoisByGroup.value[groupId] ?? [];
  });
  const activeIsoPoisPaged = computed(() => {
    const size = Math.max(1, ui.value.isoListPageSize);
    return activeIsoPois.value.slice(0, ui.value.isoListPage * size);
  });

  const topCandidates = computed(() => {
    return [...data.value.candidates]
      .filter((candidate) => typeof candidate.score === 'number')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3);
  });

  const emptyPointCollection: FeatureCollection<Point, Record<string, unknown>> = {
    type: 'FeatureCollection',
    features: []
  };
  const emptyPolygonCollection: FeatureCollection<Polygon, Record<string, unknown>> = {
    type: 'FeatureCollection',
    features: []
  };
  const DEV_LOG = import.meta.env.DEV;
  const logPoi = (message: string, payload?: Record<string, unknown>) => {
    if (!DEV_LOG) return;
    console.info('[poi-engine]', message, payload ?? {});
  };
  const toPlainBbox = (
    bbox: [number, number, number, number]
  ): [number, number, number, number] => [
    Number(bbox[0]),
    Number(bbox[1]),
    Number(bbox[2]),
    Number(bbox[3])
  ];
  const toPlainGroups = (groups: string[]): string[] =>
    Array.from(groups ?? []).map((group) => String(group));
  const degreesToRadians = (value: number) => (value * Math.PI) / 180;
  const haversineKm = (a: [number, number], b: [number, number]) => {
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
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const calcBboxMetrics = (bbox: [number, number, number, number]) => {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const widthKm = haversineKm([minLng, centerLat], [maxLng, centerLat]);
    const heightKm = haversineKm([centerLng, minLat], [centerLng, maxLat]);
    return {
      widthKm,
      heightKm,
      areaKm2: Math.max(0, widthKm * heightKm)
    };
  };
  const escapeCsv = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const formatCsvNumber = (value: number, digits: number) => {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(digits) : '';
  };
  const formatDateStamp = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };
  const sanitizeFileName = (value: string) => value.replace(/[\\/:*?"<>|]/g, '-');
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const resolveRatingLevel = (score: number, breaks: AccessibilityBaseline['ratingBreaks']) => {
    if (score >= breaks.p80) return '很高';
    if (score >= breaks.p60) return '高';
    if (score >= breaks.p40) return '中';
    if (score >= breaks.p20) return '低';
    return '很低';
  };
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const logAccess = (step: string, detail?: Record<string, unknown>) => {
    if (!ACCESS_DEBUG) return;
    console.info('[ACC]', step, detail ?? {});
  };
  const warnAccess = (step: string, detail?: Record<string, unknown>) => {
    if (!ACCESS_DEBUG) return;
    console.warn('[ACC]', step, detail ?? {});
  };
  const errorAccess = (step: string, detail?: Record<string, unknown>, error?: unknown) => {
    console.error('[ACC]', step, detail ?? {}, error ?? '');
  };
  const formatAccessError = (code: string, detail?: string) => {
    if (import.meta.env.DEV) {
      return `可达性评估失败（${code}${detail ? `: ${detail}` : ''}）`;
    }
    return '可达性评估失败，请稍后重试';
  };
  const POI_LOADING_MESSAGE = '正在加载 POI 数据...';
  let poiLoadingOverlayActive = false;
  let poiReadyPromise: Promise<void> | null = null;
  let poiWorker: Worker | null = null;
  let lastRequestId = 0;
  let expandRequestId = 0;
  let bboxStatsRequestId = 0;
  let siteSelectRequestId = 0;
  let geocodeRequestId = 0;
  let accessibilityEvalRequestId = 0;
  let accessibilityCountRequestId = 0;
  const pendingExpand = new Map<number, (zoom: number | null) => void>();
  const pendingAccessibility = new Map<number, (counts: Record<string, number[]>) => void>();
  const isoIndexedGroups = new Set<string>();
  const accessibilityCache = new Map<
    string,
    {
      ts: number;
      counts: Record<string, number[]>;
      index: number[];
      cityIndex: number[];
      rating: { level: AccessibilityLevel; score: number };
      isFallback: boolean;
    }
  >();
  let accessibilityBaselineRaw: unknown | null = null;
  let accessibilityBaselineLoadedFromFile = false;

  function extractViewportPoints(
    grouped: Record<string, FeatureCollection<Point, Record<string, unknown>>>
  ): POI[] {
    const points: POI[] = [];
    Object.values(grouped).forEach((collection) => {
      collection.features.forEach((feature) => {
        const props = feature.properties ?? {};
        if ((props as { cluster?: boolean }).cluster) {
          return;
        }
        if (!feature.geometry || feature.geometry.type !== 'Point') {
          return;
        }
        const [lon, lat] = feature.geometry.coordinates as [number, number];
        points.push({
          id: String((props as Record<string, unknown>).id ?? ''),
          name: String((props as Record<string, unknown>).name ?? 'POI'),
          type_group: String((props as Record<string, unknown>).type_group ?? 'other'),
          lon,
          lat
        });
      });
    });
    return points;
  }

  function rebuildIsoPoiList() {
    if (!isoEngine.value.active || !isoEngine.value.indexReady) {
      data.value.poisInIsochrone = [];
      return;
    }
    const groups = poiEngine.value.selectedGroups;
    const next: POI[] = [];
    groups.forEach((group) => {
      const points = isoEngine.value.pointsByGroup[group];
      if (points?.length) {
        next.push(...points);
      }
    });
    data.value.poisInIsochrone = next;
  }

  function normalizeIsoPointsByGroup(
    payloadPoints: Record<string, any>
  ): Record<string, POI[]> {
    const normalized: Record<string, POI[]> = {};
    Object.entries(payloadPoints ?? {}).forEach(([group, list]) => {
      if (!Array.isArray(list)) {
        return;
      }
      const points = list
        .map((point: any) => {
          const lon = Number(point?.lon ?? point?.lng);
          const lat = Number(point?.lat);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            return undefined;
          }
          return {
            id: String(point?.id ?? ''),
            name: String(point?.name ?? 'POI'),
            type_group: String(point?.type_group ?? group),
            lon,
            lat
          } as POI;
        })
        .filter((point: POI | undefined): point is POI => Boolean(point));
      normalized[group] = points;
    });
    return normalized;
  }

  function applyIsochroneFilter() {
    if (isoEngine.value.active) {
      return;
    }
    if (!analysis.value.isochrone) {
      data.value.poisInIsochrone = [];
      return;
    }
    data.value.poisInIsochrone = withinIsochrone(
      poiEngine.value.viewportPoints,
      analysis.value.isochrone
    );
  }

  function showLoading(message: string, detail?: string) {
    ui.value.overlay = { type: 'loading', message, detail };
  }

  function showError(message: string, detail?: string) {
    ui.value.overlay = { type: 'error', message, detail };
  }

  function showInfo(message: string) {
    ui.value.overlay = { type: 'info', message };
  }

  function hideOverlay() {
    ui.value.overlay = null;
  }

  function showPoiLoadingOverlay() {
    if (poiLoadingOverlayActive) {
      return;
    }
    ui.value.poiBlockingLoadingVisible = true;
    showLoading(POI_LOADING_MESSAGE);
    poiLoadingOverlayActive = true;
  }

  function hidePoiLoadingOverlay() {
    if (!poiLoadingOverlayActive) {
      return;
    }
    if (ui.value.overlay?.type === 'loading' && ui.value.overlay.message === POI_LOADING_MESSAGE) {
      hideOverlay();
    }
    ui.value.poiBlockingLoadingVisible = false;
    poiLoadingOverlayActive = false;
  }

  function armIsoPick() {
    cancelBboxPick();
    cancelAccessibilityPick();
    ui.value.isoPickArmed = true;
    ui.value.mapHint = '请点击任意位置生成等时圈';
  }

  function cancelIsoPick() {
    ui.value.isoPickArmed = false;
    if (!ui.value.bboxPickArmed && !ui.value.accessPickArmed) {
      ui.value.mapHint = null;
    }
  }

  function armAccessibilityPick() {
    cancelIsoPick();
    cancelBboxPick();
    ui.value.accessPickArmed = true;
    ui.value.mapHint = '请点击地图选择评估起点';
  }

  function cancelAccessibilityPick() {
    ui.value.accessPickArmed = false;
    if (!ui.value.isoPickArmed && !ui.value.bboxPickArmed) {
      ui.value.mapHint = null;
    }
  }

  function armBboxPick() {
    cancelIsoPick();
    cancelAccessibilityPick();
    ui.value.bboxPickArmed = true;
    ui.value.mapHint = '拖拽框选分析范围（ESC/取消 退出）';
  }

  function cancelBboxPick() {
    ui.value.bboxPickArmed = false;
    if (!ui.value.isoPickArmed && !ui.value.accessPickArmed) {
      ui.value.mapHint = null;
    }
  }

  type RightTab = UiState['rightTab'];

  const rightTabHasContent = (tab: RightTab) => {
    if (tab === 'iso') {
      return Boolean(
        analysis.value.isochrone ||
          route.value.active ||
          route.value.loading ||
          accessibility.value.active ||
          accessibility.value.loading
      );
    }
    return Boolean(
      siteEngine.value.results.length ||
        siteEngine.value.bbox ||
        siteEngine.value.running
    );
  };

  function setRightTab(tab: RightTab) {
    ui.value.rightTab = tab;
    ui.value.rightTabLocked = true;
  }

  function autoSwitchRightTab(tab: RightTab) {
    const current = ui.value.rightTab;
    if (ui.value.rightTabLocked && rightTabHasContent(current)) {
      return;
    }
    ui.value.rightTab = tab;
    ui.value.rightTabLocked = false;
  }

  function setSiteTargetGroup(id: string | null) {
    siteEngine.value.targetGroupId = id;
    siteEngine.value.results = [];
    siteEngine.value.expandedRanks = {};
    siteEngine.value.selectedRank = null;
    siteEngine.value.error = undefined;
  }

  function setSiteBbox(bbox: [number, number, number, number]) {
    siteEngine.value.bbox = toPlainBbox(bbox);
    siteEngine.value.bboxStats = null;
    siteEngine.value.results = [];
    siteEngine.value.expandedRanks = {};
    siteEngine.value.selectedRank = null;
    siteEngine.value.error = undefined;
    requestBboxStats(siteEngine.value.bbox);
  }

  function requestBboxStats(bbox: [number, number, number, number]) {
    if (!poiWorker || !poiEngine.value.ready) {
      siteEngine.value.bboxStats = null;
      return;
    }
    siteEngine.value.error = undefined;
    showLoading('正在统计范围内 POI...');
    bboxStatsRequestId += 1;
    const requestId = bboxStatsRequestId;
    try {
      poiWorker.postMessage({
        type: 'BBOX_STATS',
        payload: {
          bbox: toPlainBbox(bbox),
          requestId
        }
      });
    } catch (error) {
      siteEngine.value.error = error instanceof Error ? error.message : '范围统计失败';
      showError('选址错误', siteEngine.value.error);
    }
  }


  function selectSiteResult(rank: number | null) {
    siteEngine.value.selectedRank = rank;
  }

  function toggleSiteExplain(rank: number) {
    const expanded = siteEngine.value.expandedRanks[rank];
    siteEngine.value.expandedRanks = {
      ...siteEngine.value.expandedRanks,
      [rank]: !expanded
    };
  }

  function updateSiteResultAddress(rank: number, address: string) {
    const index = siteEngine.value.results.findIndex((item) => item.rank === rank);
    if (index < 0) {
      return;
    }
    siteEngine.value.results[index] = {
      ...siteEngine.value.results[index],
      address
    };
  }

  async function reverseGeocodeTop10() {
    const key = AMAP_KEY.trim();
    if (!siteEngine.value.results.length) {
      return;
    }
    if (!key) {
      siteEngine.value.results.forEach((item) => {
        updateSiteResultAddress(item.rank, `${item.lng.toFixed(5)},${item.lat.toFixed(5)}`);
      });
      return;
    }
    geocodeRequestId += 1;
    const requestId = geocodeRequestId;
    const queue = siteEngine.value.results.map((item) => ({
      rank: item.rank,
      lng: item.lng,
      lat: item.lat
    }));
    let cursor = 0;
    const concurrency = 2;
    const fetchAddress = async (entry: { rank: number; lng: number; lat: number }) => {
      const [lng, lat] =
        MAP_COORD_SYS === 'GCJ02'
          ? [entry.lng, entry.lat]
          : convertCoord([entry.lng, entry.lat], MAP_COORD_SYS, 'GCJ02');
      const url = `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(
        key
      )}&location=${lng},${lat}&radius=1000&extensions=base`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
          status?: string;
          regeocode?: { formatted_address?: string; addressComponent?: { streetNumber?: { location?: string } } };
        };
        const address =
          data.regeocode?.formatted_address ||
          data.regeocode?.addressComponent?.streetNumber?.location;
        return typeof address === 'string' && address.trim().length > 0
          ? address.trim()
          : `${entry.lng.toFixed(5)},${entry.lat.toFixed(5)}`;
      } catch (error) {
        return `${entry.lng.toFixed(5)},${entry.lat.toFixed(5)}`;
      }
    };
    const worker = async () => {
      while (cursor < queue.length) {
        const current = queue[cursor];
        cursor += 1;
        const address = await fetchAddress(current);
        if (requestId !== geocodeRequestId) {
          return;
        }
        updateSiteResultAddress(current.rank, address);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  function exportSiteResultsCsv() {
    const results = siteEngine.value.results;
    if (!results.length) {
      showInfo('暂无候选点结果可导出');
      return;
    }
    const rows = [
      [
        'rank',
        'lng',
        'lat',
        'address',
        'total',
        'demand',
        'access',
        'competition',
        'synergy',
        'center'
      ]
        .map(escapeCsv)
        .join(',')
    ];
    results.forEach((item) => {
      rows.push(
        [
          escapeCsv(item.rank),
          escapeCsv(formatCsvNumber(item.lng, 6)),
          escapeCsv(formatCsvNumber(item.lat, 6)),
          escapeCsv(item.address ?? ''),
          escapeCsv(formatCsvNumber(item.total, 4)),
          escapeCsv(formatCsvNumber(item.metrics?.demand ?? 0, 4)),
          escapeCsv(formatCsvNumber(item.metrics?.access ?? 0, 4)),
          escapeCsv(formatCsvNumber(item.metrics?.competition ?? 0, 4)),
          escapeCsv(formatCsvNumber(item.metrics?.synergy ?? 0, 4)),
          escapeCsv(formatCsvNumber(item.metrics?.center ?? 0, 4))
        ].join(',')
      );
    });
    const csv = `\ufeff${rows.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const rawLabel = siteEngine.value.targetGroupId
      ? GROUP_LABELS[siteEngine.value.targetGroupId] ?? siteEngine.value.targetGroupId
      : '候选点';
    const safeLabel = sanitizeFileName(rawLabel);
    const date = formatDateStamp(new Date());
    saveAs(blob, `${safeLabel}-Top10-${date}.csv`);
  }

  function runSiteSelectionTopN() {
    if (siteEngine.value.running) {
      showInfo('选址正在计算，请稍候');
      return;
    }
    if (!poiWorker || !poiEngine.value.ready) {
      siteEngine.value.error = '选址引擎未就绪，请稍后再试';
      showError('选址错误', siteEngine.value.error);
      return;
    }
    const bbox = siteEngine.value.bbox;
    if (!bbox) {
      showInfo('请先框选分析范围');
      return;
    }
    if (!siteEngine.value.targetGroupId) {
      showInfo('请先选择商铺类型');
      return;
    }
    const stats = siteEngine.value.bboxStats;
    if (!stats) {
      showInfo('请先统计范围内 POI');
      return;
    }
    const { maxAreaKm2, maxPoi } = siteEngine.value.constraints;
    if (stats.areaKm2 > maxAreaKm2) {
      showInfo(`范围过大（${maxAreaKm2} km2），请缩小范围`);
      return;
    }
    if (stats.poiTotal > maxPoi) {
      showInfo(`范围内 POI 过多（${maxPoi}），请缩小范围`);
      return;
    }
    siteEngine.value.error = undefined;
    siteEngine.value.running = true;
    siteEngine.value.results = [];
    siteEngine.value.expandedRanks = {};
    siteEngine.value.selectedRank = null;
    showLoading('正在计算候选点评分...', '范围越大耗时越长，请稍候');
    siteSelectRequestId += 1;
    const requestId = siteSelectRequestId;
    siteEngine.value.lastRunId = requestId;
    try {
      poiWorker.postMessage({
        type: 'SITE_SELECT',
        payload: {
          bbox: toPlainBbox(bbox),
          targetGroupId: siteEngine.value.targetGroupId,
          topN: 10,
          requestId
        }
      });
    } catch (error) {
      siteEngine.value.running = false;
      siteEngine.value.error = error instanceof Error ? error.message : '选址计算失败';
      showError('选址失败', siteEngine.value.error);
    }
  }

  function clearSiteSelection() {
    siteEngine.value.bbox = null;
    siteEngine.value.bboxStats = null;
    siteEngine.value.results = [];
    siteEngine.value.expandedRanks = {};
    siteEngine.value.selectedRank = null;
    siteEngine.value.running = false;
    siteEngine.value.error = undefined;
    siteEngine.value.lastRunId = 0;
    geocodeRequestId += 1;
    cancelBboxPick();
  }

  function setActiveIsoGroup(id: string | null) {
    ui.value.activeIsoGroupId = id;
    ui.value.isoListPage = 1;
  }

  function ensureActiveIsoGroup() {
    const stats = isoGroupStatsSorted.value;
    if (!isoEngine.value.active || stats.length === 0) {
      if (ui.value.activeIsoGroupId !== null) {
        ui.value.activeIsoGroupId = null;
      }
      ui.value.isoListPage = 1;
      return;
    }
    const activeId = ui.value.activeIsoGroupId;
    if (!activeId || !stats.some((item) => item.id === activeId)) {
      ui.value.activeIsoGroupId = stats[0].id;
      ui.value.isoListPage = 1;
    }
  }

  function loadMoreIsoPois() {
    ui.value.isoListPage += 1;
  }

  function normalizeBaseline(raw: unknown): AccessibilityBaseline {
    if (!raw || typeof raw !== 'object') {
      return ACCESS_BASELINE_FALLBACK;
    }
    const data = raw as AccessibilityBaseline;
  const thresholds = Array.isArray(data.thresholdsMin)
    ? data.thresholdsMin.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  const filtered = data.profile === 'driving-car' ? thresholds.filter((value) => value <= 30) : thresholds;
  if (!filtered.length) {
    return ACCESS_BASELINE_FALLBACK;
  }
  const coreGroups = Array.isArray(data.coreGroups) && data.coreGroups.length
    ? data.coreGroups.map((value) => String(value))
    : ACCESS_CORE_GROUPS;
  const categoryMean: Record<string, number[]> = {};
  coreGroups.forEach((group) => {
    const values = (data.categoryMean as Record<string, number[]> | undefined)?.[group];
    if (Array.isArray(values) && values.length >= filtered.length) {
      categoryMean[group] = values.slice(0, filtered.length).map((value) => Number(value));
    } else {
      categoryMean[group] = new Array(filtered.length).fill(0);
    }
  });
  const indexMean = Array.isArray(data.indexMean) && data.indexMean.length >= filtered.length
    ? data.indexMean.slice(0, filtered.length).map((value) => Number(value))
    : new Array(filtered.length).fill(1);
  const ratingBreaks = data.ratingBreaks ?? ACCESS_BASELINE_FALLBACK.ratingBreaks;
  return {
    version: Number.isFinite(Number(data.version)) ? Number(data.version) : 1,
    city: data.city ? String(data.city) : ACCESS_BASELINE_FALLBACK.city,
    thresholdsMin: filtered,
      profile: data.profile,
      coreGroups,
      categoryMean,
      indexMean,
      ratingBreaks: {
        p20: Number(ratingBreaks.p20 ?? ACCESS_BASELINE_FALLBACK.ratingBreaks.p20),
        p40: Number(ratingBreaks.p40 ?? ACCESS_BASELINE_FALLBACK.ratingBreaks.p40),
        p60: Number(ratingBreaks.p60 ?? ACCESS_BASELINE_FALLBACK.ratingBreaks.p60),
        p80: Number(ratingBreaks.p80 ?? ACCESS_BASELINE_FALLBACK.ratingBreaks.p80)
      }
    };
  }

  function resolveBaselineForProfile(
    raw: unknown,
    profile: TravelProfile
  ): { baseline: AccessibilityBaseline; profileMatch: boolean } {
    if (!raw || typeof raw !== 'object') {
      return { baseline: ACCESS_BASELINE_FALLBACK, profileMatch: profile === 'foot-walking' };
    }
    const rawObj = raw as Record<string, unknown>;
    const byProfile = rawObj.byProfile;
    if (byProfile && typeof byProfile === 'object') {
      const candidate = (byProfile as Record<string, unknown>)[profile];
      if (candidate) {
        const baseline = normalizeBaseline(candidate);
        baseline.profile = profile;
        return { baseline, profileMatch: true };
      }
    }
    const baseline = normalizeBaseline(raw);
    const match = !baseline.profile || baseline.profile === profile;
    return { baseline, profileMatch: match };
  }

  async function loadAccessibilityBaseline() {
    if (accessibilityBaselineRaw) {
      logAccess('S2_baseline_cached');
      return accessibilityBaselineRaw;
    }
    try {
      logAccess('S2_baseline_start', { url: ACCESS_BASELINE_URL });
      const response = await fetch(ACCESS_BASELINE_URL, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const raw = await response.json();
      accessibilityBaselineRaw = raw;
      accessibilityBaselineLoadedFromFile = true;
      logAccess('S2_baseline_done', { profile: (raw as any)?.profile ?? null });
    } catch (error) {
      errorAccess(
        'S2_baseline_failed',
        { reason: error instanceof Error ? error.message : 'unknown' },
        error
      );
      warnAccess('S2_baseline_fallback');
      accessibilityBaselineRaw = ACCESS_BASELINE_FALLBACK;
      accessibilityBaselineLoadedFromFile = false;
    }
    return accessibilityBaselineRaw;
  }

  function waitForPoiReady(): Promise<boolean> {
    if (poiEngine.value.ready) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const stop = watch(
        () => [poiEngine.value.ready, poiEngine.value.error],
        ([ready, error]) => {
          if (!ready && !error) {
            return;
          }
          stop();
          resolve(Boolean(ready && !error));
        },
        { immediate: true }
      );
    });
  }

  function waitForPoiStableIndex(timeoutMs = ACCESS_POI_WAIT_TIMEOUT_MS): Promise<boolean> {
    if (!poiEngine.value.buildingIndex) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const startedAt = nowMs();
      const timer = window.setTimeout(() => {
        stop();
        resolve(false);
      }, timeoutMs);
      const stop = watch(
        () => [poiEngine.value.buildingIndex, poiEngine.value.indexReady],
        ([building, indexReady]) => {
          if (!building && (indexReady || !poiEngine.value.selectedGroups.length)) {
            window.clearTimeout(timer);
            stop();
            resolve(true);
            return;
          }
          if (nowMs() - startedAt > timeoutMs) {
            window.clearTimeout(timer);
            stop();
            resolve(false);
          }
        },
        { immediate: true }
      );
    });
  }

  function computeAccessibilityIndex(
    counts: Record<string, number[]>,
    baseline: AccessibilityBaseline
  ): number[] {
    const thresholds = baseline.thresholdsMin;
    return thresholds.map((_, idx) => {
      let sum = 0;
      let groupCount = 0;
      baseline.coreGroups.forEach((group) => {
        const groupCounts = counts[group] ?? [];
        const value = Number(groupCounts[idx] ?? 0);
        const baseValue = Number(baseline.categoryMean[group]?.[idx] ?? 0);
        const denom = Math.log1p(baseValue + 1);
        const norm = denom > 0 ? Math.log1p(value) / denom : 0;
        sum += clamp(norm, 0, 2);
        groupCount += 1;
      });
      return groupCount ? sum / groupCount : 0;
    });
  }

  function computeCompositeScore(values: number[], thresholds: number[]): number {
    const length = Math.min(values.length, thresholds.length);
    if (length <= 0) {
      return 0;
    }
    if (length === 1) {
      return values[0] ?? 0;
    }
    let weighted = 0;
    let weightSum = 0;
    for (let i = 0; i < length - 1; i += 1) {
      const t0 = thresholds[i] ?? 0;
      const t1 = thresholds[i + 1] ?? t0;
      const span = Math.max(1, t1 - t0);
      const v0 = values[i] ?? 0;
      const v1 = values[i + 1] ?? v0;
      weighted += ((v0 + v1) / 2) * span;
      weightSum += span;
    }
    return weightSum ? weighted / weightSum : values[0] ?? 0;
  }

  function buildRating(
    index: number[],
    thresholds: number[],
    baseline: AccessibilityBaseline
  ): { level: AccessibilityLevel; score: number } {
    const score = computeCompositeScore(index, thresholds);
    return {
      level: resolveRatingLevel(score, baseline.ratingBreaks),
      score
    };
  }

  function buildAccessibilityCacheKey(
    origin: { lng: number; lat: number },
    profile: TravelProfile,
    thresholds: number[]
  ) {
    return `${profile}|${origin.lng.toFixed(5)},${origin.lat.toFixed(5)}|${thresholds.join(',')}`;
  }

  function requestPolygonCounts(
    polygons: Array<Feature<Polygon | MultiPolygon> | null>,
    groups: string[]
  ): Promise<Record<string, number[]>> {
    if (!poiWorker) {
      return Promise.reject(new Error('WorkerNotReady'));
    }
    accessibilityCountRequestId += 1;
    const requestId = accessibilityCountRequestId;
    const startedAt = nowMs();
    const groupsPlain = toPlainGroups(groups);
    const polygonsPlain = polygons.map((polygon) =>
      polygon ? toPlainFeature(polygon) : null
    );
    logAccess('S5_worker_post', {
      requestId,
      groups: groupsPlain.length,
      polygons: polygonsPlain.length
    });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingAccessibility.delete(requestId);
        warnAccess('S5_worker_timeout', {
          requestId,
          timeoutMs: ACCESS_WORKER_TIMEOUT_MS
        });
        reject(new Error('WorkerTimeout'));
      }, ACCESS_WORKER_TIMEOUT_MS);
      pendingAccessibility.set(requestId, (counts) => {
        window.clearTimeout(timer);
        logAccess('S5_worker_done', {
          requestId,
          tookMs: Math.round(nowMs() - startedAt),
          keys: Object.keys(counts ?? {})
        });
        resolve(counts);
      });
      poiWorker?.postMessage({
        type: 'COUNT_IN_POLYGONS',
        payload: {
          polygons: polygonsPlain,
          groups: groupsPlain,
          requestId
        }
      });
    });
  }

  function clearAccessibility() {
    accessibility.value.active = false;
    accessibility.value.loading = false;
    accessibility.value.error = undefined;
    accessibility.value.notice = undefined;
    accessibility.value.origin = undefined;
    accessibility.value.profile = filters.value.travelMode;
    accessibility.value.thresholdsMin =
      accessibility.value.baseline?.thresholdsMin ?? ACCESS_BASELINE_FALLBACK.thresholdsMin;
    accessibility.value.coreGroups =
      accessibility.value.baseline?.coreGroups ?? ACCESS_CORE_GROUPS;
    accessibility.value.counts = undefined;
    accessibility.value.index = undefined;
    accessibility.value.cityIndex = undefined;
    accessibility.value.rating = undefined;
    accessibility.value.dirty = false;
    accessibility.value.isFallback = false;
    accessibility.value.baselineProfileMatch = true;
    cancelAccessibilityPick();
  }

  async function evaluateAccessibilityAtOrigin(
    origin?: { lng: number; lat: number },
    profile?: TravelProfile
  ) {
    const evalStartedAt = nowMs();
    logAccess('S1_start', {
      origin,
      profile: profile ?? filters.value.travelMode
    });
    const targetOrigin =
      origin ?? isoEngine.value.origin ?? iso.value.origin ?? accessibility.value.origin;
    if (!targetOrigin) {
      warnAccess('S1_missing_origin');
      showInfo('请先在地图上选择评估起点');
      return;
    }
    accessibility.value.origin = { ...targetOrigin };
    accessibility.value.profile = profile ?? filters.value.travelMode;
    accessibility.value.loading = true;
    accessibility.value.error = undefined;
    accessibility.value.notice = undefined;
    accessibility.value.isFallback = false;
    accessibility.value.active = true;
    accessibility.value.dirty = false;

    if (!poiEngine.value.ready) {
      logAccess('S1_poi_init');
      initPoiEngine({ showOverlay: false });
      const ready = await waitForPoiReady();
      if (!ready) {
        accessibility.value.loading = false;
        accessibility.value.error = formatAccessError('P1', 'POI_NOT_READY');
        errorAccess('S1_poi_not_ready');
        return;
      }
    }
    const poiStable = await waitForPoiStableIndex();
    if (!poiStable) {
      accessibility.value.loading = false;
      accessibility.value.error = formatAccessError('P2', 'POI_INDEX_TIMEOUT');
      errorAccess('S1_poi_index_timeout');
      return;
    }
    logAccess('S1_done', { tookMs: Math.round(nowMs() - evalStartedAt) });

    const baselineRaw = await loadAccessibilityBaseline();
    const resolved = resolveBaselineForProfile(baselineRaw, accessibility.value.profile);
    const baseline = resolved.baseline;
    const rawThresholds = baseline.thresholdsMin;
    const thresholdsMin =
      accessibility.value.profile === 'driving-car'
        ? rawThresholds.filter((value) => value <= 30)
        : rawThresholds;
    if (!thresholdsMin.length) {
      accessibility.value.loading = false;
      accessibility.value.error = formatAccessError('A2', 'NO_THRESHOLDS');
      errorAccess('S2_no_thresholds');
      return;
    }
    accessibility.value.baseline = baseline;
    accessibility.value.baselineLoadedFromFile = accessibilityBaselineLoadedFromFile;
    accessibility.value.baselineProfileMatch = resolved.profileMatch;
    if (!resolved.profileMatch) {
      const readable =
        baseline.profile === 'driving-car'
          ? '驾车'
          : baseline.profile === 'cycling-regular'
            ? '骑行'
            : '步行';
      accessibility.value.notice = `当前出行方式无城市基线，已使用${readable}基线（仅供参考）`;
    }
    if (!accessibility.value.baselineLoadedFromFile) {
      accessibility.value.notice =
        accessibility.value.notice ?? '城市基线读取失败，已使用内置基线（仅供参考）';
    }
    accessibility.value.thresholdsMin = thresholdsMin;
    accessibility.value.coreGroups = baseline.coreGroups;
    const cacheKey = buildAccessibilityCacheKey(
      targetOrigin,
      accessibility.value.profile,
      thresholdsMin
    );
    const cached = accessibilityCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < ACCESS_CACHE_TTL_MS) {
      logAccess('S2_cache_hit', { cacheKey });
      accessibility.value.counts = cached.counts;
      accessibility.value.index = cached.index;
      accessibility.value.cityIndex = cached.cityIndex;
      accessibility.value.rating = cached.rating;
      accessibility.value.isFallback = cached.isFallback;
      accessibility.value.loading = false;
      return;
    }

    const thresholdsSec = thresholdsMin.map((value) => value * 60);
    if (accessibilityAbort) {
      accessibilityAbort.abort();
    }
    const controller = new AbortController();
    accessibilityAbort = controller;
    const requestId = ++accessibilityEvalRequestId;

      try {
        const [lonWgs, latWgs] = toWgs84([targetOrigin.lng, targetOrigin.lat]);
        logAccess('S3_ors_start', {
          requestId,
          profile: accessibility.value.profile,
          originWgs: [Number(lonWgs.toFixed(6)), Number(latWgs.toFixed(6))],
          rangesSec: thresholdsSec
        });
        const orsStartedAt = nowMs();
        const result = await fetchIsochrones({
          lon: lonWgs,
          lat: latWgs,
          profile: accessibility.value.profile,
          ranges: thresholdsSec,
          signal: controller.signal
        });
        if (requestId !== accessibilityEvalRequestId) {
          return;
        }
        logAccess('S3_ors_done', {
          requestId,
          tookMs: Math.round(nowMs() - orsStartedAt),
          isFallback: result.isFallback,
          error: result.error,
          status: result.status
        });
        if (result.isFallback) {
          warnAccess('S3_ors_fallback', {
            requestId,
            error: result.error,
            status: result.status,
            statusText: result.statusText,
            responseText: result.responseText
          });
        }
        accessibility.value.isFallback = result.isFallback;
        logAccess('S4_polygons_start', { requestId });
        const s4StartedAt = nowMs();
        const geojson = transformGeoJSON(result.data, (coord) => toMapCoord(coord));
        if (
          !geojson ||
          geojson.type !== 'FeatureCollection' ||
          !Array.isArray(geojson.features)
        ) {
          accessibility.value.loading = false;
          accessibility.value.error = formatAccessError('A4', 'ISO_INVALID');
          errorAccess('S4_invalid_geojson', { requestId });
          return;
        }
        const featureMap = new Map<number, Feature<Polygon | MultiPolygon>>();
        const featureList: Array<{
          feature: Feature<Polygon | MultiPolygon>;
          value: number | null;
        }> = [];
        geojson.features.forEach((feature) => {
          if (!feature.geometry) return;
          if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
            return;
          }
          const props = feature.properties as Record<string, unknown> | null | undefined;
          const rawValue = props?.value ?? props?.contour ?? props?.bucket;
          const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
          if (Number.isFinite(value)) {
            featureMap.set(value, feature as Feature<Polygon | MultiPolygon>);
          }
          featureList.push({
            feature: feature as Feature<Polygon | MultiPolygon>,
            value: Number.isFinite(value) ? value : null
          });
        });
        const fallbackFeatures = featureList
          .slice()
          .sort((a, b) => {
            const av = a.value ?? Number.POSITIVE_INFINITY;
            const bv = b.value ?? Number.POSITIVE_INFINITY;
            return av - bv;
          })
          .map((item) => item.feature);
        const polygons = thresholdsSec.map((range, index) => {
          const feature =
            featureMap.get(range) ??
            featureMap.get(range / 60) ??
            fallbackFeatures[index];
          return feature ? toPlainFeature(feature) : null;
        });
        logAccess('S4_polygons_done', {
          requestId,
          tookMs: Math.round(nowMs() - s4StartedAt),
          features: geojson.features.length,
          matched: polygons.filter(Boolean).length,
          thresholds: thresholdsSec.length
        });
        if (polygons.every((item) => !item)) {
          accessibility.value.loading = false;
          accessibility.value.error = formatAccessError('A5', 'POLYGON_EMPTY');
          errorAccess('S4_empty_polygons', { requestId });
          return;
        }
        const counts = await requestPolygonCounts(polygons, baseline.coreGroups);
        if (requestId !== accessibilityEvalRequestId) {
          return;
        }
        logAccess('S6_index_start', { requestId });
        const s6StartedAt = nowMs();
        const index = computeAccessibilityIndex(counts, baseline);
        const cityIndex = accessibility.value.baselineProfileMatch
          ? baseline.indexMean.length === index.length
            ? baseline.indexMean
            : computeAccessibilityIndex(baseline.categoryMean, baseline)
          : undefined;
        const rating = buildRating(index, thresholdsMin, baseline);
        logAccess('S6_done', {
          requestId,
          tookMs: Math.round(nowMs() - s6StartedAt),
          rating: rating.level,
          score: Number(rating.score.toFixed(3))
        });
        accessibility.value.counts = counts;
        accessibility.value.index = index;
        accessibility.value.cityIndex = cityIndex;
        accessibility.value.rating = rating;
        accessibility.value.loading = false;
        accessibility.value.error = result.isFallback
          ? '当前为近似评估（ORS 不可用）'
          : undefined;
      accessibilityCache.set(cacheKey, {
        ts: Date.now(),
        counts,
        index,
        cityIndex,
        rating,
        isFallback: result.isFallback
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        accessibility.value.loading = false;
        const reason =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'UNKNOWN';
        const code = reason === 'WorkerTimeout' ? 'W1' : reason === 'WorkerNotReady' ? 'W2' : 'A9';
        accessibility.value.error = formatAccessError(code, reason);
        errorAccess('S6_failed', { requestId, reason }, error);
      }
    }
  function initPoiEngine(options: { showOverlay?: boolean } = {}) {
    if (poiWorker) {
      if (options.showOverlay && !poiEngine.value.ready) {
        showPoiLoadingOverlay();
      }
      return;
    }
    poiEngine.value.prefetchStarted = true;
    poiEngine.value.loadingPois = true;
    poiEngine.value.buildingIndex = false;
    poiEngine.value.queryLoading = false;
    poiEngine.value.error = undefined;
    poiEngine.value.indexReady = false;
    poiEngine.value.initialRendered = false;
    if (options.showOverlay) {
      showPoiLoadingOverlay();
    }

    poiWorker = new Worker(new URL('../workers/poi.worker.ts', import.meta.url), {
      type: 'module'
    });

    poiWorker.onmessage = (event) => {
      const { type, payload } = event.data as {
        type: string;
        payload: any;
      };
      if (type === 'INIT_DONE') {
        poiEngine.value.ready = true;
        poiEngine.value.loadingPois = false;
        poiEngine.value.typeCounts = { ...(payload.typeCounts ?? {}) };
        if ('address' in poiEngine.value.typeCounts) {
          delete poiEngine.value.typeCounts.address;
        }
        poiEngine.value.rulesMeta = payload.rulesMeta ?? null;
        poiEngine.value.error = undefined;
        poiEngine.value.selectedGroups = [];
        poiEngine.value.buildingIndex = false;
        poiEngine.value.queryLoading = false;
        poiEngine.value.indexReady = false;
        poiEngine.value.poiByGroup = {};
        poiEngine.value.hullByGroup = {};
        hidePoiLoadingOverlay();
        logPoi('init_done', {
          groups: Object.keys(poiEngine.value.typeCounts).length,
          total: payload.total ?? 0
        });
        return;
      }
      if (type === 'INDEX_READY') {
        poiEngine.value.buildingIndex = false;
        poiEngine.value.indexReady = true;
        poiEngine.value.queryLoading = false;
        hidePoiLoadingOverlay();
        logPoi('index_ready', {
          groups: payload?.groups ?? poiEngine.value.selectedGroups
        });
        if (poiEngine.value.pendingViewport || !poiEngine.value.initialRendered) {
          maybeRequestInitialViewport();
        }
        return;
      }
      if (type === 'ISO_INDEX_READY') {
        if (payload.requestId !== isoEngine.value.lastIsoRequestId) {
          return;
        }
        const builtGroups = Array.isArray(payload?.builtGroups)
          ? payload.builtGroups
          : [];
        builtGroups.forEach((group: string) => isoIndexedGroups.add(group));
        if (payload?.pointsByGroup) {
          const normalized = normalizeIsoPointsByGroup(payload.pointsByGroup);
          isoEngine.value.pointsByGroup = {
            ...isoEngine.value.pointsByGroup,
            ...normalized
          };
        }
        isoEngine.value.countsByGroup = {
          ...isoEngine.value.countsByGroup,
          ...(payload?.countsByGroup ?? {})
        };
        isoEngine.value.indexing = false;
        isoEngine.value.indexReady = true;
        rebuildIsoPoiList();
        ensureActiveIsoGroup();
        if (isoEngine.value.active) {
          const missingGroups = poiEngine.value.selectedGroups.filter(
            (group) => !isoIndexedGroups.has(group)
          );
          if (missingGroups.length) {
            applyIsochroneToPoi(missingGroups);
          }
        }
        if (poiEngine.value.lastViewport) {
          requestViewportPois(
            poiEngine.value.lastViewport.bbox,
            poiEngine.value.lastViewport.zoom
          );
        }
        logPoi('iso_index_ready', {
          groups: builtGroups.length,
          tookMs: payload?.tookMs
        });
        return;
      }
      if (type === 'ISO_CLEARED') {
        isoIndexedGroups.clear();
        isoEngine.value.indexing = false;
        isoEngine.value.indexReady = false;
        isoEngine.value.countsByGroup = {};
        isoEngine.value.pointsByGroup = {};
        data.value.poisInIsochrone = [];
        return;
      }
      if (type === 'BBOX_STATS_RESULT') {
        if (payload.requestId !== bboxStatsRequestId) {
          return;
        }
        const bbox = siteEngine.value.bbox;
        if (bbox) {
          const metrics = calcBboxMetrics(bbox);
          siteEngine.value.error = undefined;
          siteEngine.value.bboxStats = {
            ...metrics,
            poiTotal: Number(payload.poiTotal ?? 0),
            byGroup: payload.byGroup ?? {}
          };
        } else {
          siteEngine.value.bboxStats = null;
        }
        hideOverlay();
        return;
      }
      if (type === 'SITE_SELECT_RESULT') {
        if (payload.requestId !== siteSelectRequestId) {
          return;
        }
        const results = Array.isArray(payload.results) ? payload.results : [];
        siteEngine.value.running = false;
        siteEngine.value.error = undefined;
        siteEngine.value.results = results.map((item: any, index: number) => ({
          rank: index + 1,
          lng: Number(item.lng),
          lat: Number(item.lat),
          total: Number(item.total ?? 0),
          metrics: {
            demand: Number(item.metrics?.demand ?? 0),
            access: Number(item.metrics?.access ?? 0),
            competition: Number(item.metrics?.competition ?? 0),
            synergy: Number(item.metrics?.synergy ?? 0),
            center: Number(item.metrics?.center ?? 0)
          },
          address: item.address,
          debug: item.debug
        }));
        siteEngine.value.expandedRanks = {};
        siteEngine.value.selectedRank =
          siteEngine.value.results.length > 0 ? siteEngine.value.results[0].rank : null;
        hideOverlay();
        autoSwitchRightTab('site');
        reverseGeocodeTop10();
        return;
      }
      if (type === 'QUERY_RESULT') {
        if (payload.requestId !== lastRequestId) {
          return;
        }
        const results = payload.results ?? {};
        const selected = new Set(poiEngine.value.selectedGroups);
        const nextPoiByGroup: Record<string, FeatureCollection<Point, Record<string, unknown>>> = {};
        const nextHullByGroup: Record<string, FeatureCollection<Polygon, Record<string, unknown>>> = {};
        selected.forEach((group) => {
          const entry = results[group];
          nextPoiByGroup[group] = entry?.points ?? emptyPointCollection;
          nextHullByGroup[group] = entry?.hulls ?? emptyPolygonCollection;
        });
        poiEngine.value.poiByGroup = nextPoiByGroup;
        poiEngine.value.hullByGroup = nextHullByGroup;
        poiEngine.value.viewportPoints = extractViewportPoints(nextPoiByGroup);
        poiEngine.value.queryLoading = false;
        applyIsochroneFilter();
        logPoi('query_result', {
          requestId: payload.requestId,
          groups: Object.keys(nextPoiByGroup).length,
          points: poiEngine.value.viewportPoints.length
        });
        return;
      }
      if (type === 'EXPAND_RESULT') {
        const resolver = pendingExpand.get(payload.requestId);
        if (resolver) {
          resolver(typeof payload.zoom === 'number' ? payload.zoom : null);
          pendingExpand.delete(payload.requestId);
        }
        return;
      }
        if (type === 'POLYGON_COUNTS') {
          const resolver = pendingAccessibility.get(payload.requestId);
          if (resolver) {
            resolver(payload?.counts ?? {});
            pendingAccessibility.delete(payload.requestId);
          } else {
            warnAccess('S5_worker_orphan', { requestId: payload.requestId });
          }
          return;
        }
      if (type === 'ERROR') {
        const sourceType = String(payload?.sourceType ?? 'UNKNOWN');
        const message = payload?.message ?? 'POI 引擎错误';
        const stack = payload?.stack;
        if (stack) {
          console.error('[poi-worker] error stack', { sourceType, stack });
        } else {
          console.error('[poi-worker] error', { sourceType, message });
        }
        if (sourceType === 'SITE_SELECT' || sourceType === 'BBOX_STATS') {
          siteEngine.value.running = false;
          siteEngine.value.error = message;
          showError('选址失败', siteEngine.value.error);
          return;
        }
        poiEngine.value.loadingPois = false;
        poiEngine.value.buildingIndex = false;
        poiEngine.value.queryLoading = false;
        poiEngine.value.indexReady = false;
        siteEngine.value.running = false;
        pendingExpand.forEach((resolve) => resolve(null));
        pendingExpand.clear();
        poiEngine.value.error = message;
        isoEngine.value.indexing = false;
        if (poiLoadingOverlayActive) {
          showError('POI 引擎错误', poiEngine.value.error);
          poiLoadingOverlayActive = false;
          ui.value.poiBlockingLoadingVisible = false;
        }
      }
    };

    poiWorker.postMessage({
      type: 'INIT',
      payload: {
        poiUrl: POI_URL,
        rulesUrl: RULES_URL,
        coordSysConfig: {
          poiCoordSys: POI_COORD_SYS,
          mapCoordSys: MAP_COORD_SYS
        }
      }
    });
  }

  function prefetchPoisSilently() {
    if (poiEngine.value.prefetchStarted || poiEngine.value.ready) {
      return;
    }
    logPoi('prefetch_start');
    initPoiEngine({ showOverlay: false });
  }

  function ensurePoisReadyForWorkbench(): Promise<void> {
    if (poiEngine.value.ready) {
      return Promise.resolve();
    }
    initPoiEngine({ showOverlay: true });
    if (poiReadyPromise) {
      return poiReadyPromise;
    }
    poiReadyPromise = new Promise((resolve) => {
      const stop = watch(
        () => [poiEngine.value.ready, poiEngine.value.error],
        ([ready, error]) => {
          if (!ready && !error) {
            return;
          }
          if (error) {
            ui.value.poiBlockingLoadingVisible = false;
            poiLoadingOverlayActive = false;
            showError('POI 引擎错误', error);
          } else {
            hidePoiLoadingOverlay();
          }
          stop();
          poiReadyPromise = null;
          resolve();
        },
        { immediate: true }
      );
    });
    return poiReadyPromise;
  }

  function setMapReady(ready: boolean) {
    poiEngine.value.mapReady = ready;
    logPoi('map_ready', { ready });
    if (ready) {
      maybeRequestInitialViewport();
    }
  }

  function maybeRequestInitialViewport() {
    if (!poiWorker || !poiEngine.value.ready) return;
    if (!poiEngine.value.mapReady || !poiEngine.value.indexReady) return;
    if (!poiEngine.value.selectedGroups.length) return;
    if (poiEngine.value.buildingIndex) return;
    const viewport = poiEngine.value.pendingViewport ?? poiEngine.value.lastViewport;
    if (!viewport) return;
    requestViewportPois(viewport.bbox, viewport.zoom);
  }

  function updateViewport(bbox: [number, number, number, number], zoom: number) {
    const viewport = { bbox: toPlainBbox(bbox), zoom: Number(zoom) };
    poiEngine.value.lastViewport = viewport;
    if (!poiEngine.value.initialRendered) {
      poiEngine.value.pendingViewport = viewport;
    }
  }

  function setSelectedGroups(groups: string[]) {
    const unique = Array.from(new Set(toPlainGroups(groups)))
      .filter((group) => Boolean(group) && group !== 'address');
    poiEngine.value.selectedGroups = unique;
    poiEngine.value.initialRendered = false;
    logPoi('set_selected', { groups: unique });
    if (!unique.length) {
      poiEngine.value.buildingIndex = false;
      poiEngine.value.indexReady = false;
      poiEngine.value.queryLoading = false;
      poiEngine.value.pendingViewport = null;
      poiEngine.value.poiByGroup = {};
      poiEngine.value.hullByGroup = {};
      poiEngine.value.viewportPoints = [];
      data.value.poisInIsochrone = [];
      return;
    }
    poiEngine.value.indexReady = false;
    if (poiWorker && poiEngine.value.ready) {
      poiEngine.value.buildingIndex = true;
      const groupsPlain = toPlainGroups(unique);
      poiWorker.postMessage({
        type: 'BUILD_INDEX',
        payload: { groups: groupsPlain }
      });
      logPoi('build_index', { groups: groupsPlain });
    } else {
      poiEngine.value.buildingIndex = false;
    }
    if (poiEngine.value.lastViewport) {
      requestViewportPois(
        poiEngine.value.lastViewport.bbox,
        poiEngine.value.lastViewport.zoom
      );
    }
    if (isoEngine.value.active && isoEngine.value.indexReady) {
      const addedGroups = unique.filter((group) => !isoIndexedGroups.has(group));
      if (addedGroups.length) {
        applyIsochroneToPoi(addedGroups);
      }
    }
    if (isoEngine.value.active) {
      rebuildIsoPoiList();
      ensureActiveIsoGroup();
    }
  }

  function requestViewportPois(
    bbox: [number, number, number, number],
    zoom: number
  ): boolean {
    const bboxPlain = toPlainBbox(bbox);
    const zoomPlain = Number(zoom);
    const viewport = { bbox: bboxPlain, zoom: zoomPlain };
    poiEngine.value.lastViewport = viewport;
    if (!poiEngine.value.selectedGroups.length) {
      poiEngine.value.pendingViewport = viewport;
      poiEngine.value.poiByGroup = {};
      poiEngine.value.hullByGroup = {};
      poiEngine.value.viewportPoints = [];
      data.value.poisInIsochrone = [];
      logPoi('query_skip_empty', { bbox: bboxPlain, zoom: zoomPlain });
      return false;
    }
    const useIso = false;
    if (!poiWorker || !poiEngine.value.ready || !poiEngine.value.mapReady) {
      poiEngine.value.pendingViewport = viewport;
      const groupsPlain = toPlainGroups(poiEngine.value.selectedGroups);
      logPoi('query_pending', {
        bbox: bboxPlain,
        zoom: zoomPlain,
        ready: poiEngine.value.ready,
        mapReady: poiEngine.value.mapReady,
        indexReady: poiEngine.value.indexReady,
        buildingIndex: poiEngine.value.buildingIndex,
        useIso,
        groups: groupsPlain.length
      });
      return false;
    }
    if (!poiEngine.value.indexReady || poiEngine.value.buildingIndex) {
      poiEngine.value.pendingViewport = viewport;
      const groupsPlain = toPlainGroups(poiEngine.value.selectedGroups);
      logPoi('query_pending', {
        bbox: bboxPlain,
        zoom: zoomPlain,
        ready: poiEngine.value.ready,
        mapReady: poiEngine.value.mapReady,
        indexReady: poiEngine.value.indexReady,
        buildingIndex: poiEngine.value.buildingIndex,
        useIso,
        groups: groupsPlain.length
      });
      return false;
    }
    lastRequestId += 1;
    poiEngine.value.pendingViewport = null;
    poiEngine.value.queryLoading = true;
    const groupsPlain = toPlainGroups(poiEngine.value.selectedGroups);
    const includeHull = poiEngine.value.showClusterExtent;
    logPoi('query_send', {
      requestId: lastRequestId,
      bbox: bboxPlain,
      zoom: zoomPlain,
      groups: groupsPlain,
      includeHull,
      useIso
    });
    poiWorker.postMessage({
      type: 'QUERY',
      payload: {
        bbox: bboxPlain,
        zoom: zoomPlain,
        groups: groupsPlain,
        includeHull,
        requestId: lastRequestId,
        useIso
      }
    });
    if (!poiEngine.value.initialRendered) {
      poiEngine.value.initialRendered = true;
    }
    return true;
  }

  function expandCluster(group: string, clusterId: number): Promise<number | null> {
    if (!poiWorker) {
      return Promise.resolve(null);
    }
    expandRequestId += 1;
    const requestId = expandRequestId;
    return new Promise((resolve) => {
      pendingExpand.set(requestId, resolve);
      const useIso = false;
      poiWorker?.postMessage({
        type: 'EXPAND',
        payload: { group, clusterId, requestId, useIso }
      });
    });
  }

  function setMapCenter(center: [number, number], zoom?: number) {
    map.value.center = center;
    if (typeof zoom === 'number') {
      map.value.zoom = zoom;
    }
  }

  function setMapStyleUrl(url?: string) {
    map.value.styleUrl = url;
  }

  watchEffect(() => {
    if (poiEngine.value.initialRendered) {
      return;
    }
    if (!poiEngine.value.mapReady || !poiEngine.value.ready) {
      return;
    }
    if (!poiEngine.value.indexReady || poiEngine.value.buildingIndex) {
      return;
    }
    if (!poiEngine.value.selectedGroups.length) {
      return;
    }
    const viewport = poiEngine.value.pendingViewport ?? poiEngine.value.lastViewport;
    if (!viewport) {
      return;
    }
    requestViewportPois(viewport.bbox, viewport.zoom);
  });

  watch(
    () => isoGroupStatsSorted.value.map((item) => item.id).join('|'),
    () => {
      ensureActiveIsoGroup();
    }
  );

  function setTravelMode(mode: TravelProfile) {
    filters.value.travelMode = mode;
    iso.value.profile = mode;
    if (iso.value.origin && (isoEngine.value.active || iso.value.active)) {
      iso.value.dirty = true;
    }
    if (accessibility.value.active) {
      accessibility.value.profile = mode;
      accessibility.value.dirty = true;
    }
    abortIsochroneRequest();
  }

  function setTravelTimes(times: number[]) {
    filters.value.times = times.sort((a, b) => a - b);
    iso.value.rangesMin = filters.value.times.map((value) => Math.round(value / 60));
    if (iso.value.origin && (isoEngine.value.active || iso.value.active)) {
      iso.value.dirty = true;
    }
    abortIsochroneRequest();
  }

  const isochroneCache = new Map<
    string,
    { ts: number; geojson: FeatureCollection; isFallback: boolean; error?: string }
  >();
  let isochroneAbort: AbortController | null = null;
  let isochroneRequestId = 0;
  let accessibilityAbort: AbortController | null = null;

  const routeCache = new Map<
    string,
    {
      ts: number;
      geojson: FeatureCollection;
      summary?: { distance: number; duration: number };
      steps?: Array<{ instruction: string; distance: number; duration: number }>;
      isFallback: boolean;
    }
  >();
  let routeAbort: AbortController | null = null;
  let routeRequestId = 0;

  function abortIsochroneRequest() {
    if (isochroneAbort) {
      isochroneAbort.abort();
      isochroneAbort = null;
      iso.value.loading = false;
    }
    hideOverlay();
  }

  function setIsoOriginFromMapClick(lng: number, lat: number) {
    iso.value.origin = { lng, lat };
    isoEngine.value.origin = { lng, lat };
    if (iso.value.active) {
      iso.value.dirty = true;
    }
    if (accessibility.value.active) {
      accessibility.value.dirty = true;
    }
  }

  function pickIsoPolygon(
    geojson?: FeatureCollection
  ): Feature<Polygon | MultiPolygon> | undefined {
    if (!geojson?.features?.length) {
      return undefined;
    }
    let winner: Feature<Polygon | MultiPolygon> | undefined;
    let bestValue = -Infinity;
    geojson.features.forEach((feature) => {
      if (!feature.geometry) {
        return;
      }
      if (
        feature.geometry.type !== 'Polygon' &&
        feature.geometry.type !== 'MultiPolygon'
      ) {
        return;
      }
      const props = feature.properties as Record<string, unknown> | null | undefined;
      const rawValue = props?.value ?? props?.contour ?? props?.bucket;
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      if (Number.isFinite(value) && value > bestValue) {
        bestValue = value;
        winner = feature as Feature<Polygon | MultiPolygon>;
      }
    });
    if (winner) {
      return winner;
    }
    const fallback = geojson.features.find(
      (feature) =>
        feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'
    );
    return fallback as Feature<Polygon | MultiPolygon> | undefined;
  }

  function toPlainFeature<T>(feature: T): T {
    return JSON.parse(JSON.stringify(feature)) as T;
  }

  function applyIsochroneToPoi(groups?: string[]) {
    if (!poiWorker || !isoEngine.value.active || !isoEngine.value.polygon) {
      return;
    }
    const selected = (groups ?? poiEngine.value.selectedGroups).filter(
      (group) => Boolean(group) && group !== 'address'
    );
    if (!selected.length) {
      isoEngine.value.indexing = false;
      isoEngine.value.indexReady = false;
      isoEngine.value.countsByGroup = {};
      isoEngine.value.pointsByGroup = {};
      data.value.poisInIsochrone = [];
      return;
    }
    isoEngine.value.indexing = true;
    isoEngine.value.lastIsoRequestId += 1;
    const requestId = isoEngine.value.lastIsoRequestId;
    const polygonPlain = toPlainFeature(isoEngine.value.polygon);
    const groupsPlain = toPlainGroups(selected);
    poiWorker.postMessage({
      type: 'APPLY_ISOCHRONE',
      payload: {
        polygon: polygonPlain,
        groups: groupsPlain,
        requestId
      }
    });
  }

  function activateIsoEngine(geojson: FeatureCollection, origin: { lng: number; lat: number }) {
    const polygon = pickIsoPolygon(geojson);
    if (!polygon) {
      return;
    }
    isoEngine.value.active = true;
    isoEngine.value.origin = { ...origin };
    isoEngine.value.polygon = polygon;
    isoEngine.value.indexing = false;
    isoEngine.value.indexReady = false;
    isoEngine.value.countsByGroup = {};
    isoEngine.value.pointsByGroup = {};
    isoEngine.value.lastIsoRequestId = 0;
    isoIndexedGroups.clear();
    data.value.poisInIsochrone = [];
    ui.value.activeIsoGroupId = null;
    ui.value.isoListPage = 1;
    if (poiWorker) {
      poiWorker.postMessage({ type: 'CLEAR_ISOCHRONE' });
    }
    applyIsochroneToPoi();
  }

  function buildIsoRanges(
    profile: TravelProfile,
    rangesSec: number[]
  ): { ranges: number[]; notice?: string } {
    const limits: Record<TravelProfile, number> = {
      'driving-car': 3600,
      'cycling-regular': 18000,
      'foot-walking': 72000
    };
    const maxSec = limits[profile];
    const uniqueRanges = Array.from(
      new Set(rangesSec.filter((value) => Number.isFinite(value) && value > 0))
    ).sort((a, b) => a - b);
    const limitedByCount = uniqueRanges.slice(0, 10);
    const limitedByMax = limitedByCount.filter((value) => value <= maxSec);
    let notice = '';
    if (uniqueRanges.length > 10) {
      notice = '等时圈档位超过上限，已自动截断至 10 个区间。';
    }
    if (limitedByMax.length < limitedByCount.length) {
      const maxMin = Math.floor(maxSec / 60);
      notice = `等时圈时间超过 ORS 限制（最大 ${maxMin} 分钟），已自动截断。`;
    }
    return {
      ranges: limitedByMax,
      notice: notice || undefined
    };
  }

  async function generateIsochrones(origin?: [number, number]) {
    const nextOrigin = origin
      ? { lng: origin[0], lat: origin[1] }
      : iso.value.origin;
    if (!nextOrigin) {
      iso.value.error = '请先在地图上点击起点。';
      showInfo('请先在地图上点击起点。');
      return;
    }

    iso.value.origin = nextOrigin;
    iso.value.profile = filters.value.travelMode;
    iso.value.rangesMin = filters.value.times.map((value) => Math.round(value / 60));
    iso.value.loading = true;
    iso.value.error = undefined;
    iso.value.isFallback = false;

    const rangesSec = filters.value.times;
    if (!rangesSec.length) {
      iso.value.loading = false;
      iso.value.error = '请至少选择一个时间阈值。';
      showInfo('请至少选择一个时间阈值。');
      return;
    }

    const { ranges, notice } = buildIsoRanges(filters.value.travelMode, rangesSec);
    if (!ranges.length) {
      iso.value.loading = false;
      iso.value.error = notice ?? '等时圈时间超出 ORS 限制，请调整。';
      showInfo(iso.value.error);
      return;
    }
    iso.value.rangesMin = ranges.map((value) => Math.round(value / 60));
    if (notice) {
      iso.value.error = notice;
    }
    showLoading('正在生成等时圈...');

    const [lonWgs, latWgs] = gcj02ToWgs84(nextOrigin.lng, nextOrigin.lat);
    const cacheKey = `${filters.value.travelMode}|time|${ranges.join(',')}|${lonWgs.toFixed(
      5
    )},${latWgs.toFixed(5)}`;
    const cached = isochroneCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < ISO_CACHE_TTL_MS) {
      iso.value.geojson = cached.geojson;
      iso.value.isFallback = cached.isFallback;
      iso.value.error = cached.error;
      iso.value.loading = false;
      iso.value.active = true;
      iso.value.dirty = false;
      analysis.value.isochrone = cached.geojson;
      applyIsochroneFilter();
      activateIsoEngine(cached.geojson, nextOrigin);
      hideOverlay();
      autoSwitchRightTab('iso');
      return;
    }

    if (isochroneAbort) {
      isochroneAbort.abort();
    }
    const controller = new AbortController();
    isochroneAbort = controller;
    isochroneRequestId += 1;
    const requestId = isochroneRequestId;

    try {
      const result = await fetchIsochrones({
        lon: lonWgs,
        lat: latWgs,
        profile: filters.value.travelMode,
        ranges,
        signal: controller.signal
      });
      if (requestId !== isochroneRequestId) {
        return;
      }
      const gcjGeojson = transformGeoJSON(result.data, ([lng, lat]) =>
        wgs84ToGcj02(lng, lat)
      );
      iso.value.geojson = gcjGeojson;
      iso.value.isFallback = result.isFallback;
      iso.value.loading = false;
      iso.value.active = true;
      iso.value.dirty = false;
      analysis.value.isochrone = gcjGeojson;
      applyIsochroneFilter();
      activateIsoEngine(gcjGeojson, nextOrigin);
      isochroneCache.set(cacheKey, {
        ts: Date.now(),
        geojson: gcjGeojson,
        isFallback: result.isFallback,
        error: iso.value.error
      });
      hideOverlay();
      autoSwitchRightTab('iso');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (requestId !== isochroneRequestId) {
        return;
      }
      iso.value.loading = false;
      iso.value.error = '等时圈生成失败，请稍后重试。';
      showError('等时圈生成失败', iso.value.error);
    }
  }

  function resolveRouteStart(): { lng: number; lat: number } | undefined {
    if (isoEngine.value.active && isoEngine.value.origin) {
      return isoEngine.value.origin;
    }
    return isoEngine.value.origin ?? iso.value.origin;
  }

  function toWgs84(coord: [number, number]): [number, number] {
    if (MAP_COORD_SYS === 'WGS84') {
      return coord;
    }
    return convertCoord(coord, MAP_COORD_SYS, 'WGS84');
  }

  function toMapCoord(coord: [number, number]): [number, number] {
    if (MAP_COORD_SYS === 'WGS84') {
      return coord;
    }
    return convertCoord(coord, 'WGS84', MAP_COORD_SYS);
  }

  function resolveRouteError(
    code?: 'missing_key' | 'service_error' | 'limit' | 'auth',
    status?: number
  ): string {
    if (code === 'limit' || status === 429) {
      return '当前为直线近似（ORS 不可用，已触发限流）';
    }
    if (code === 'auth' || status === 401 || status === 403) {
      return '当前为直线近似（ORS 不可用，鉴权失败）';
    }
    if (status && status >= 500) {
      return '当前为直线近似（ORS 服务异常）';
    }
    return '当前为直线近似（ORS 不可用）';
  }

  function clearRoute() {
    if (routeAbort) {
      routeAbort.abort();
      routeAbort = null;
    }
    route.value = {
      active: false,
      loading: false,
      profile: filters.value.travelMode,
      start: undefined,
      end: undefined,
      isFallback: false,
      geojson: undefined,
      summary: undefined,
      steps: undefined,
      error: undefined
    };
  }

  async function planRouteToPoi(poi: POI) {
    const start = resolveRouteStart();
    if (!start) {
      route.value = {
        ...route.value,
        active: false,
        loading: false,
        error: '请先在地图上选择起点。'
      };
      showInfo('请先在地图上选择起点。');
      return;
    }
    const profile = filters.value.travelMode;
    const poiCoord = poi as POI & { lng?: number };
    const endLng = Number(poiCoord.lon ?? poiCoord.lng);
    const endLat = Number(poi.lat);
    if (!Number.isFinite(endLng) || !Number.isFinite(endLat)) {
      route.value = {
        ...route.value,
        active: false,
        loading: false,
        error: '路线结果无效，请重试。'
      };
      showError('路线规划失败', '路线结果无效，请重试。');
      return;
    }
    const end = { lng: endLng, lat: endLat };
    route.value = {
      ...route.value,
      active: true,
      loading: true,
      profile,
      start,
      end,
      isFallback: false,
      geojson: undefined,
      summary: undefined,
      steps: undefined,
      error: undefined
    };
    showLoading('正在规划路线...');

    const [startLngW, startLatW] = toWgs84([start.lng, start.lat]);
    const [endLngW, endLatW] = toWgs84([end.lng, end.lat]);
    const cacheKey = `${profile}|${startLngW.toFixed(5)},${startLatW.toFixed(
      5
    )}|${endLngW.toFixed(5)},${endLatW.toFixed(5)}`;
    const cached = routeCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < ROUTE_CACHE_TTL_MS) {
      route.value = {
        ...route.value,
        active: true,
        loading: false,
        profile,
        start,
        end,
        isFallback: cached.isFallback,
        geojson: cached.geojson,
        summary: cached.summary,
        steps: cached.steps,
        error: cached.isFallback ? '当前为直线近似（ORS 不可用）' : undefined
      };
      hideOverlay();
      return;
    }

    if (routeAbort) {
      routeAbort.abort();
    }
    const controller = new AbortController();
    routeAbort = controller;
    routeRequestId += 1;
    const requestId = routeRequestId;

    try {
      const result = await fetchDirectionsGeojson({
        start: [startLngW, startLatW],
        end: [endLngW, endLatW],
        profile,
        signal: controller.signal
      });
      if (requestId !== routeRequestId) {
        return;
      }
      const mapGeojson = transformGeoJSONCoordinates(result.data, (coord) =>
        toMapCoord(coord)
      );
      route.value = {
        ...route.value,
        active: true,
        loading: false,
        profile,
        start,
        end,
        isFallback: result.isFallback,
        geojson: mapGeojson,
        summary: result.summary,
        steps: result.steps,
        error: result.isFallback ? resolveRouteError(result.error, result.status) : undefined
      };
      if (route.value.error) {
        showInfo(route.value.error);
      } else {
        hideOverlay();
      }
      if (!result.isFallback) {
        routeCache.set(cacheKey, {
          ts: Date.now(),
          geojson: mapGeojson,
          summary: result.summary,
          steps: result.steps,
          isFallback: result.isFallback
        });
      }
      if (import.meta.env.DEV) {
        console.info('[route]', {
          profile,
          start: [startLngW, startLatW],
          end: [endLngW, endLatW],
          summary: result.summary,
          fallback: result.isFallback
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (requestId !== routeRequestId) {
        return;
      }
      const fallbackGeojson: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [start.lng, start.lat],
                [end.lng, end.lat]
              ]
            },
            properties: {}
          }
        ]
      };
      route.value = {
        ...route.value,
        active: true,
        loading: false,
        isFallback: true,
        geojson: fallbackGeojson,
        error: '当前为直线近似（ORS 不可用）'
      };
      showError('路线规划失败', route.value.error);
    }
  }

  function addCandidate(candidate: CandidateWithMetrics) {
    const index = data.value.candidates.findIndex((item) => item.id === candidate.id);
    if (index >= 0) {
      data.value.candidates[index] = { ...candidate };
    } else {
      data.value.candidates.push({ ...candidate });
    }
  }

  function removeCandidate(id: string) {
    data.value.candidates = data.value.candidates.filter((candidate) => candidate.id !== id);
  }

  function updateSitingWeights(weights: Partial<SitingWeights>) {
    analysis.value.sitingWeights = {
      ...analysis.value.sitingWeights,
      ...weights
    };
  }

  function scoreCandidateSites() {
    const scored = scoring(data.value.candidates, analysis.value.sitingWeights);
    data.value.candidates = scored.map((item) => ({
      ...item.poi,
      score: item.score
    }));
  }

  function clearIsochrones() {
    abortIsochroneRequest();
    iso.value.origin = undefined;
    iso.value.geojson = undefined;
    iso.value.loading = false;
    iso.value.error = undefined;
    iso.value.isFallback = false;
    iso.value.active = false;
    iso.value.dirty = false;
    analysis.value.isochrone = undefined;
    data.value.poisInIsochrone = [];
    isoEngine.value.active = false;
    isoEngine.value.polygon = undefined;
    isoEngine.value.origin = undefined;
    isoEngine.value.indexing = false;
    isoEngine.value.indexReady = false;
    isoEngine.value.countsByGroup = {};
    isoEngine.value.pointsByGroup = {};
    isoEngine.value.lastIsoRequestId = 0;
    isoIndexedGroups.clear();
    data.value.poisInIsochrone = [];
    if (poiWorker) {
      poiWorker.postMessage({ type: 'CLEAR_ISOCHRONE' });
    }
    if (poiEngine.value.lastViewport) {
      requestViewportPois(
        poiEngine.value.lastViewport.bbox,
        poiEngine.value.lastViewport.zoom
      );
    }
    clearRoute();
  }

  function resetIsochrone() {
    clearIsochrones();
  }

  return {
    map,
    mapCoordSys: MAP_COORD_SYS,
    filters,
    data,
    ui,
    iso,
    isoEngine,
    route,
    accessibility,
    poiEngine,
    analysis,
    siteEngine,
    nanjingBounds,
    visiblePoisInIsochrone,
    isoGroupStatsSorted,
    isoPoisByGroup,
    activeIsoPois,
    activeIsoPoisPaged,
    topCandidates,
    initPoiEngine,
    prefetchPoisSilently,
    ensurePoisReadyForWorkbench,
    showLoading,
    showError,
    showInfo,
    hideOverlay,
    armIsoPick,
    cancelIsoPick,
    armAccessibilityPick,
    cancelAccessibilityPick,
    armBboxPick,
    cancelBboxPick,
    setRightTab,
    setSiteTargetGroup,
    setSiteBbox,
    runSiteSelectionTopN,
    exportSiteResultsCsv,
    clearSiteSelection,
    selectSiteResult,
    toggleSiteExplain,
    setMapReady,
    updateViewport,
    setSelectedGroups,
    requestViewportPois,
    expandCluster,
    setMapCenter,
    setMapStyleUrl,
    setTravelMode,
    setTravelTimes,
    setIsoOriginFromMapClick,
    generateIsochrones,
    planRouteToPoi,
    addCandidate,
    removeCandidate,
    updateSitingWeights,
    scoreCandidateSites,
    setActiveIsoGroup,
    ensureActiveIsoGroup,
    loadMoreIsoPois,
    loadAccessibilityBaseline,
    evaluateAccessibilityAtOrigin,
    clearAccessibility,
    clearRoute,
    clearIsochrones,
    resetIsochrone
  };
});
