import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { FeatureCollection, Point } from 'geojson';
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
  loading: boolean;
  ready: boolean;
  error?: string;
  typeCounts: Record<string, number>;
  selectedGroups: string[];
  viewportPoiFC: FeatureCollection<Point, Record<string, unknown>>;
  viewportPoints: POI[];
  rulesMeta?: Record<string, unknown> | null;
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
    loading: false,
    ready: false,
    error: undefined,
    typeCounts: {},
    selectedGroups: [],
    viewportPoiFC: {
      type: 'FeatureCollection',
      features: []
    },
    viewportPoints: [],
    rulesMeta: null
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

  const emptyFeatureCollection: FeatureCollection<Point, Record<string, unknown>> = {
    type: 'FeatureCollection',
    features: []
  };
  let poiWorker: Worker | null = null;
  let pendingViewport: { bbox: [number, number, number, number]; zoom: number } | null = null;
  let lastViewport: { bbox: [number, number, number, number]; zoom: number } | null = null;
  let lastRequestId = 0;

  function extractViewportPoints(
    collection: FeatureCollection<Point, Record<string, unknown>>
  ): POI[] {
    return collection.features
      .map((feature) => {
        const props = feature.properties ?? {};
        if ((props as { cluster?: boolean }).cluster) {
          return undefined;
        }
        if (!feature.geometry || feature.geometry.type !== 'Point') {
          return undefined;
        }
        const [lon, lat] = feature.geometry.coordinates as [number, number];
      return {
        id: String((props as Record<string, unknown>).id ?? ''),
        name: String((props as Record<string, unknown>).name ?? 'POI'),
        type_group: String((props as Record<string, unknown>).type_group ?? 'other'),
        lon,
        lat
      } as POI;
    })
      .filter(Boolean) as POI[];
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
    poiEngine.value.loading = true;
    poiEngine.value.error = undefined;

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
        poiEngine.value.typeCounts = payload.typeCounts ?? {};
        poiEngine.value.rulesMeta = payload.rulesMeta ?? null;
        poiEngine.value.error = undefined;
        if (!poiEngine.value.selectedGroups.length) {
          const sortedGroups = Object.entries(poiEngine.value.typeCounts)
            .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .map(([group]) => group);
          poiEngine.value.selectedGroups = sortedGroups.filter((group) => group !== 'address');
        }
        poiEngine.value.loading = true;
        poiWorker?.postMessage({
          type: 'BUILD_INDEX',
          payload: { selectedGroups: poiEngine.value.selectedGroups }
        });
        return;
      }
      if (type === 'INDEX_READY') {
        poiEngine.value.loading = false;
        poiEngine.value.selectedGroups = payload.selectedGroups ?? poiEngine.value.selectedGroups;
        if (pendingViewport) {
          const { bbox, zoom } = pendingViewport;
          pendingViewport = null;
          requestViewportPois(bbox, zoom);
        }
        return;
      }
      if (type === 'QUERY_RESULT') {
        if (payload.requestId !== lastRequestId) {
          return;
        }
        poiEngine.value.viewportPoiFC = payload.fc ?? emptyFeatureCollection;
        poiEngine.value.viewportPoints = extractViewportPoints(
          poiEngine.value.viewportPoiFC
        );
        applyIsochroneFilter();
        return;
      }
      if (type === 'ERROR') {
        poiEngine.value.loading = false;
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

  function setSelectedGroups(groups: string[]) {
    const unique = Array.from(new Set(groups)).filter(Boolean);
    poiEngine.value.selectedGroups = unique;
    poiEngine.value.loading = true;
    poiEngine.value.viewportPoiFC = emptyFeatureCollection;
    poiEngine.value.viewportPoints = [];
    data.value.poisInIsochrone = [];
    if (poiWorker && poiEngine.value.ready) {
      poiWorker.postMessage({
        type: 'BUILD_INDEX',
        payload: { selectedGroups: unique }
      });
    }
    if (lastViewport) {
      requestViewportPois(lastViewport.bbox, lastViewport.zoom);
    }
  }

  function requestViewportPois(bbox: [number, number, number, number], zoom: number) {
    lastViewport = { bbox, zoom };
    if (!poiWorker || !poiEngine.value.ready || poiEngine.value.loading) {
      pendingViewport = { bbox, zoom };
      return;
    }
    lastRequestId += 1;
    poiWorker.postMessage({
      type: 'QUERY',
      payload: { bbox, zoom, requestId: lastRequestId }
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
    setSelectedGroups,
    requestViewportPois,
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
