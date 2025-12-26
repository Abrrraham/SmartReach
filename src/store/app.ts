import { computed, ref, watch, watchEffect } from 'vue';
import { defineStore } from 'pinia';
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
  listPageSize: number;
  listPage: number;
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
    listPageSize: 200,
    listPage: 1
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
    const size = Math.max(1, ui.value.listPageSize);
    return activeIsoPois.value.slice(0, ui.value.listPage * size);
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
  let poiWorker: Worker | null = null;
  let lastRequestId = 0;
  let expandRequestId = 0;
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

  function setActiveIsoGroup(id: string | null) {
    ui.value.activeIsoGroupId = id;
    ui.value.listPage = 1;
  }

  function ensureActiveIsoGroup() {
    const stats = isoGroupStatsSorted.value;
    if (!isoEngine.value.active || stats.length === 0) {
      if (ui.value.activeIsoGroupId !== null) {
        ui.value.activeIsoGroupId = null;
      }
      ui.value.listPage = 1;
      return;
    }
    const activeId = ui.value.activeIsoGroupId;
    if (!activeId || !stats.some((item) => item.id === activeId)) {
      ui.value.activeIsoGroupId = stats[0].id;
      ui.value.listPage = 1;
    }
  }

  function loadMoreIsoPois() {
    ui.value.listPage += 1;
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
        poiEngine.value.loadingPois = false;
        poiEngine.value.buildingIndex = false;
        poiEngine.value.queryLoading = false;
        poiEngine.value.indexReady = false;
        pendingExpand.forEach((resolve) => resolve(null));
        pendingExpand.clear();
        poiEngine.value.error = payload.message ?? 'POI 引擎错误';
        isoEngine.value.indexing = false;
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
    ui.value.listPage = 1;
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
      return;
    }

    const { ranges, notice } = buildIsoRanges(filters.value.travelMode, rangesSec);
    if (!ranges.length) {
      iso.value.loading = false;
      iso.value.error = notice ?? '等时圈时间超出 ORS 限制，请调整。';
      return;
    }
    iso.value.rangesMin = ranges.map((value) => Math.round(value / 60));
    if (notice) {
      iso.value.error = notice;
    }

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
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (requestId !== isochroneRequestId) {
        return;
      }
      iso.value.loading = false;
      iso.value.error = '等时圈生成失败，请稍后重试。';
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
        error: 'è·¯çº¿ç»“æžœæ— æ•ˆï¼Œè¯·é‡è¯•ã€?'
      };
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
    nanjingBounds,
    visiblePoisInIsochrone,
    isoGroupStatsSorted,
    isoPoisByGroup,
    activeIsoPois,
    activeIsoPoisPaged,
    topCandidates,
    initPoiEngine,
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
