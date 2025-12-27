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
  bboxPickArmed: boolean;
  mapHint: string | null;
  overlay: OverlayState | null;
  rightTab: 'iso' | 'site';
  rightTabLocked: boolean;
}

interface PoiEngineState {
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
    bboxPickArmed: false,
    mapHint: null,
    overlay: null,
    rightTab: 'iso',
    rightTabLocked: false
  });

  const poiEngine = ref<PoiEngineState>({
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
        color: GROUP_COLORS[groupId] ?? '#868e96',
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
  let poiWorker: Worker | null = null;
  let lastRequestId = 0;
  let expandRequestId = 0;
  let bboxStatsRequestId = 0;
  let siteSelectRequestId = 0;
  let geocodeRequestId = 0;
  const pendingExpand = new Map<number, (zoom: number | null) => void>();
  const isoIndexedGroups = new Set<string>();

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

  function armIsoPick() {
    cancelBboxPick();
    ui.value.isoPickArmed = true;
    ui.value.mapHint = '请点击任意位置生成等时圈';
  }

  function cancelIsoPick() {
    ui.value.isoPickArmed = false;
    if (!ui.value.bboxPickArmed) {
      ui.value.mapHint = null;
    }
  }

  function armBboxPick() {
    cancelIsoPick();
    ui.value.bboxPickArmed = true;
    ui.value.mapHint = '拖拽框选分析范围（ESC/取消 退出）';
  }

  function cancelBboxPick() {
    ui.value.bboxPickArmed = false;
    if (!ui.value.isoPickArmed) {
      ui.value.mapHint = null;
    }
  }

  type RightTab = UiState['rightTab'];

  const rightTabHasContent = (tab: RightTab) => {
    if (tab === 'iso') {
      return Boolean(analysis.value.isochrone || route.value.active || route.value.loading);
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

  function initPoiEngine() {
    if (poiWorker) {
      return;
    }
    poiEngine.value.loadingPois = true;
    poiEngine.value.buildingIndex = false;
    poiEngine.value.queryLoading = false;
    poiEngine.value.error = undefined;
    poiEngine.value.indexReady = false;
    poiEngine.value.initialRendered = false;
    showLoading('正在加载 POI 数据...');

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
        hideOverlay();
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
        hideOverlay();
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
        showError('POI 引擎错误', poiEngine.value.error);
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
      showLoading('正在构建 POI 索引...');
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
    abortIsochroneRequest();
  }

  function setTravelTimes(times: number[]) {
    filters.value.times = times.sort((a, b) => a - b);
    iso.value.rangesMin = filters.value.times.map((value) => Math.round(value / 60));
    abortIsochroneRequest();
  }

  const isochroneCache = new Map<
    string,
    { ts: number; geojson: FeatureCollection; isFallback: boolean; error?: string }
  >();
  let isochroneAbort: AbortController | null = null;
  let isochroneRequestId = 0;

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
    iso.value.geojson = undefined;
    iso.value.loading = false;
    iso.value.error = undefined;
    iso.value.isFallback = false;
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
    filters,
    data,
    ui,
    iso,
    isoEngine,
    route,
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
    showLoading,
    showError,
    showInfo,
    hideOverlay,
    armIsoPick,
    cancelIsoPick,
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
    clearRoute,
    clearIsochrones,
    resetIsochrone
  };
});
