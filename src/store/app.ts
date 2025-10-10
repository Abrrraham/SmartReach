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
import { isochrones as fetchIsochrones, directions as fetchDirections, matrix as fetchMatrix } from '../services/ors';

interface MapState {
  center: [number, number];
  zoom: number;
  styleUrl?: string;
}

interface FilterState {
  categories: string[];
  travelMode: TravelProfile;
  times: number[];
}

interface DataState {
  pois: POI[];
  poisInIsochrone: POI[];
  candidates: CandidateWithMetrics[];
}

interface AnalysisState {
  isochrone?: FeatureCollection;
  route?: GeoJSON.Feature;
  sitingWeights: SitingWeights;
}

const DEFAULT_CATEGORIES: FilterState['categories'] = [
  'medical',
  'pharmacy',
  'market',
  'supermarket',
  'convenience',
  'education',
  'school',
  'university',
  'bus_stop',
  'metro',
  'charging',
  'park',
  'other'
];

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
    categories: [...DEFAULT_CATEGORIES],
    travelMode: 'foot-walking',
    times: [300, 600, 900]
  });

  const data = ref<DataState>({
    pois: [],
    poisInIsochrone: [],
    candidates: []
  });

  const analysis = ref<AnalysisState>({
    isochrone: undefined,
    route: undefined,
    sitingWeights: { ...INITIAL_WEIGHTS }
  });

  const nanjingBounds = computed(() => bboxOfNanjing());

  const poisFeatureCollection = computed<FeatureCollection<Point>>(() => ({
    type: 'FeatureCollection',
    features: data.value.pois.map((poi) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [poi.lon, poi.lat]
      },
      properties: { ...poi }
    }))
  }));

  const filteredPois = computed(() => {
    return data.value.pois.filter((poi) => filters.value.categories.includes(poi.category));
  });

  const filteredPoisFeatureCollection = computed<FeatureCollection<Point>>(() => ({
    type: 'FeatureCollection',
    features: filteredPois.value.map((poi) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [poi.lon, poi.lat]
      },
      properties: { ...poi }
    }))
  }));

  const topCandidates = computed(() => {
    return [...data.value.candidates]
      .filter((candidate) => typeof candidate.score === 'number')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3);
  });

  async function loadPois() {
    try {
      const response = await fetch('/data/nanjing_poi.geojson');
      if (!response.ok) {
        throw new Error(`加载 POI 失败: ${response.statusText}`);
      }
      const geojson = (await response.json()) as FeatureCollection<Point, Record<string, any>>;
      data.value.pois = geojson.features
        .map((feature, index) => {
          if (!feature.geometry || feature.geometry.type !== 'Point') {
            return undefined;
          }
          const props = feature.properties ?? {};
          return {
            id: props.id ?? `${index}`,
            name: props.name ?? props.title ?? `POI-${index}`,
            category: props.category ?? 'other',
            subcategory: props.subcategory,
            lon: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
            address: props.address,
            score: props.score
          } as POI;
        })
        .filter(Boolean) as POI[];
    } catch (error) {
      console.error('[appStore] 加载 POI 数据失败', error);
      data.value.pois = [];
    }
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

  function toggleCategory(category: string) {
    const index = filters.value.categories.indexOf(category);
    if (index >= 0) {
      filters.value.categories.splice(index, 1);
    } else {
      filters.value.categories.push(category);
    }
    applyIsochroneFilter();
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

  function applyIsochroneFilter() {
    if (analysis.value.isochrone) {
      const hits = withinIsochrone(filteredPois.value, analysis.value.isochrone);
      data.value.poisInIsochrone = hits;
    } else {
      data.value.poisInIsochrone = [];
    }
  }

  return {
    map,
    filters,
    data,
    analysis,
    nanjingBounds,
    poisFeatureCollection,
    filteredPoisFeatureCollection,
    topCandidates,
    loadPois,
    setMapCenter,
    setMapStyleUrl,
    toggleCategory,
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
