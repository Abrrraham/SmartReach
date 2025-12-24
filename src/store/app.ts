import { computed, ref, watchEffect } from 'vue';
import { defineStore } from 'pinia';
import type { FeatureCollection, Point, Polygon } from 'geojson';
import type { POI } from '../types/poi';
import {
  bboxOfNanjing,
  withinIsochrone,
  nearestByTimeOrDistance,
  scoring,
  type CandidateWithMetrics,
  type SitingWeights,
  type TravelProfile
} from '../utils/spatial';
import { normalizeCoordSys, type CoordSys } from '../utils/coord';
import { isochrones as fetchIsochrones, directions as fetchDirections, matrix as fetchMatrix } from '../services/ors';

interface MapState {
  center: [number, number];
  zoom: number;
  styleUrl?: string;
}

interface FilterState {
  travelMode: TravelProfile;
  times: number[];
}

interface DataState {
  poisInIsochrone: POI[];
  candidates: CandidateWithMetrics[];
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
  route?: GeoJSON.Feature;
  sitingWeights: SitingWeights;
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

  const data = ref<DataState>({
    poisInIsochrone: [],
    candidates: []
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
    route: undefined,
    sitingWeights: { ...INITIAL_WEIGHTS }
  });

  const nanjingBounds = computed(() => bboxOfNanjing());
  const visiblePoisInIsochrone = computed(() => data.value.poisInIsochrone);

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

  function applyIsochroneFilter() {
    if (analysis.value.isochrone) {
      data.value.poisInIsochrone = withinIsochrone(
        poiEngine.value.viewportPoints,
        analysis.value.isochrone
      );
    } else {
      data.value.poisInIsochrone = [];
    }
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
    if (
      !poiWorker ||
      !poiEngine.value.ready ||
      !poiEngine.value.mapReady ||
      !poiEngine.value.indexReady ||
      poiEngine.value.buildingIndex
    ) {
      poiEngine.value.pendingViewport = viewport;
      const groupsPlain = toPlainGroups(poiEngine.value.selectedGroups);
      logPoi('query_pending', {
        bbox: bboxPlain,
        zoom: zoomPlain,
        ready: poiEngine.value.ready,
        mapReady: poiEngine.value.mapReady,
        indexReady: poiEngine.value.indexReady,
        buildingIndex: poiEngine.value.buildingIndex,
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
      includeHull
    });
    poiWorker.postMessage({
      type: 'QUERY',
      payload: {
        bbox: bboxPlain,
        zoom: zoomPlain,
        groups: groupsPlain,
        includeHull,
        requestId: lastRequestId
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
      poiWorker?.postMessage({
        type: 'EXPAND',
        payload: { group, clusterId, requestId }
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

  function setTravelMode(mode: TravelProfile) {
    filters.value.travelMode = mode;
  }

  function setTravelTimes(times: number[]) {
    filters.value.times = times.sort((a, b) => a - b);
  }

  async function generateIsochrones(origin: [number, number]) {
    const ranges = filters.value.times;
    const profile = filters.value.travelMode;
    const result = await fetchIsochrones({
      lon: origin[0],
      lat: origin[1],
      profile,
      ranges
    });
    analysis.value.isochrone = result;

    applyIsochroneFilter();
  }

  async function planRouteToPoi(poi: POI, origin: [number, number]) {
    const profile = filters.value.travelMode;
    const feature = await fetchDirections({
      start: origin,
      end: [poi.lon, poi.lat],
      profile
    });
    analysis.value.route = feature;

    const matrixResult = await fetchMatrix({
      locations: [origin, [poi.lon, poi.lat]],
      profile
    });

    const estimations = nearestByTimeOrDistance(
      origin,
      [poi],
      'time',
      matrixResult,
      profile
    );

    if (estimations[0]) {
      data.value.poisInIsochrone = data.value.poisInIsochrone.map((candidate) => {
        if (candidate.id === poi.id) {
          return {
            ...candidate,
            score: Math.round(estimations[0].durationMin)
          };
        }
        return candidate;
      });
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

  function resetIsochrone() {
    analysis.value.isochrone = undefined;
    analysis.value.route = undefined;
    data.value.poisInIsochrone = [];
  }

  return {
    map,
    filters,
    data,
    poiEngine,
    analysis,
    nanjingBounds,
    visiblePoisInIsochrone,
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
    generateIsochrones,
    planRouteToPoi,
    addCandidate,
    removeCandidate,
    updateSitingWeights,
    scoreCandidateSites,
    resetIsochrone
  };
});
