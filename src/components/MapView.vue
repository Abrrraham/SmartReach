<template>
  <div class="map-view">
    <div ref="mapContainer" class="map-canvas" aria-label="主地图" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import maplibregl, { Map, GeoJSONSource, LngLatLike } from 'maplibre-gl';
import MaplibreGeocoder, {
  type CarmenGeojsonFeature,
  type MaplibreGeocoderFeatureResults
} from '@maplibre/maplibre-gl-geocoder';
import { storeToRefs } from 'pinia';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { POI } from '../types/poi';
import { useAppStore } from '../store/app';
import { buildAmapRasterStyle } from '../services/style';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';

const BASEMAP_PROVIDER = (
  (import.meta.env.VITE_BASEMAP_PROVIDER as string | undefined) ?? 'amap'
).toLowerCase();
const ENV_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
const AMAP_KEY = (import.meta.env.VITE_AMAP_KEY as string | undefined) ?? '';
const HAS_AMAP_KEY = AMAP_KEY.trim().length > 0;

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
    }
  },
  layers: [
    {
      id: 'osm-raster',
      type: 'raster',
      source: 'osm-raster'
    }
  ]
};
const AMAP_STYLE: maplibregl.StyleSpecification = buildAmapRasterStyle();

const POI_SOURCE_ID = 'pois';
const ISOCHRONE_SOURCE_ID = 'isochrones';
const ROUTE_SOURCE_ID = 'route';

const emit = defineEmits<{
  (event: 'click-poi', poi: POI): void;
  (event: 'map-click', coordinates: [number, number]): void;
}>();

const mapContainer = ref<HTMLDivElement | null>(null);
const mapInstance = ref<Map>();
const store = useAppStore();
const { map, nanjingBounds, analysis, poiEngine } = storeToRefs(store);
const viewportDebounceMs = 120;
let viewportTimer: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeRaf = 0;

function scheduleViewportQuery() {
  if (viewportTimer) {
    window.clearTimeout(viewportTimer);
  }
  viewportTimer = window.setTimeout(() => {
    const mapRef = mapInstance.value;
    if (!mapRef) return;
    const bounds = mapRef.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth()
    ];
    const zoom = Math.floor(mapRef.getZoom());
    store.requestViewportPois(bbox, zoom);
  }, viewportDebounceMs);
}

function resolveDefaultStyle(): maplibregl.StyleSpecification {
  return BASEMAP_PROVIDER === 'osm' ? OSM_STYLE : AMAP_STYLE;
}

function scheduleMapResize() {
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = requestAnimationFrame(() => {
    mapInstance.value?.resize();
    resizeRaf = 0;
  });
}

function attachResizeObserver(target?: HTMLElement | null) {
  if (!target) return;
  resizeObserver = new ResizeObserver(() => {
    scheduleMapResize();
  });
  resizeObserver.observe(target);
  window.addEventListener('resize', scheduleMapResize);
}

function buildInitialStyle(): string | maplibregl.StyleSpecification {
  return map.value.styleUrl && map.value.styleUrl.length > 0 ? map.value.styleUrl : resolveDefaultStyle();
}

function logBasemapConfig() {
  const styleSource = map.value.styleUrl && map.value.styleUrl.length > 0
    ? 'env_or_custom'
    : BASEMAP_PROVIDER === 'osm'
      ? 'osm_default'
      : 'amap_default';
  console.info('[map] basemap config', {
    provider: BASEMAP_PROVIDER,
    envStyleUrl: ENV_STYLE_URL ?? '(empty)',
    hasAmapKey: HAS_AMAP_KEY,
    styleSource
  });
  if (BASEMAP_PROVIDER !== 'osm' && !HAS_AMAP_KEY) {
    console.warn('[map] VITE_AMAP_KEY missing; AMap tiles may fail to load.');
  }
}

function ensurePoiLayers(map: Map) {
  if (map.getSource(POI_SOURCE_ID)) {
    return;
  }

  map.addSource(POI_SOURCE_ID, {
    type: 'geojson',
    data: poiEngine.value.viewportPoiFC
  });

  map.addLayer({
    id: 'poi-clusters',
    type: 'circle',
    source: POI_SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        '#4c6ef5',
        10,
        '#1c7ed6',
        50,
        '#1971c2'
      ],
      'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 50, 30],
      'circle-opacity': 0.85
    }
  });

  map.addLayer({
    id: 'poi-cluster-count',
    type: 'symbol',
    source: POI_SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': 12
    },
    paint: {
      'text-color': '#ffffff'
    }
  });

  map.addLayer({
    id: 'poi-symbol',
    type: 'circle',
    source: POI_SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-color': [
        'match',
        ['get', 'type_group'],
        'food',
        '#e03131',
        'shopping',
        '#12b886',
        'life_service',
        '#f76707',
        'medical',
        '#d6336c',
        'education_culture',
        '#1c7ed6',
        'transport',
        '#1098ad',
        'lodging',
        '#845ef7',
        'finance',
        '#4c6ef5',
        'government',
        '#495057',
        'company',
        '#339af0',
        'entertainment_sports',
        '#f59f00',
        'tourism',
        '#2f9e44',
        'public_facility',
        '#adb5bd',
        'residential_realestate',
        '#5c7cfa',
        'address',
        '#ced4da',
        '#868e96'
      ]
    }
  });
}

function ensureIsochroneLayers(map: Map) {
  if (!map.getSource(ISOCHRONE_SOURCE_ID)) {
    map.addSource(ISOCHRONE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'isochrones-fill',
      type: 'fill',
      source: ISOCHRONE_SOURCE_ID,
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'contour'], 300, '#748ffc', 900, '#364fc7'],
        'fill-opacity': 0.2
      }
    });

    map.addLayer({
      id: 'isochrones-outline',
      type: 'line',
      source: ISOCHRONE_SOURCE_ID,
      paint: {
        'line-color': '#364fc7',
        'line-width': 2
      }
    });
  }
}

function ensureRouteLayer(map: Map) {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': '#ff922b',
        'line-width': 4,
        'line-opacity': 0.8
      }
    });
  }
}

function updatePoiSource(collection: FeatureCollection<Point, Record<string, unknown>>) {
  const map = mapInstance.value;
  if (!map) return;
  const source = map.getSource(POI_SOURCE_ID) as GeoJSONSource | undefined;
  if (source) {
    source.setData(collection);
  }
}

function setIsochrones(geojson?: FeatureCollection) {
  const map = mapInstance.value;
  if (!map) return;
  ensureIsochroneLayers(map);

  const source = map.getSource(ISOCHRONE_SOURCE_ID) as GeoJSONSource | undefined;
  if (source) {
    source.setData(geojson ?? { type: 'FeatureCollection', features: [] });
  }
}

function setRoute(feature?: GeoJSON.Feature<LineString>) {
  const map = mapInstance.value;
  if (!map) return;
  ensureRouteLayer(map);

  const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
  if (source) {
    source.setData(
      feature
        ? ({
            type: 'FeatureCollection',
            features: [feature]
          } as FeatureCollection)
        : { type: 'FeatureCollection', features: [] }
    );
  }
}

function setupMap() {
  if (!mapContainer.value) return;

  logBasemapConfig();
  const mapInstanceLocal = new maplibregl.Map({
    container: mapContainer.value,
    style: buildInitialStyle(),
    center: map.value.center as LngLatLike,
    zoom: map.value.zoom,
    maxBounds: nanjingBounds.value
  });

  const resizeTarget = mapContainer.value?.parentElement ?? mapContainer.value;
  attachResizeObserver(resizeTarget);

  mapInstanceLocal.addControl(new maplibregl.NavigationControl(), 'top-right');

  const geocoder = new MaplibreGeocoder(
    {
      forwardGeocode: async (config): Promise<MaplibreGeocoderFeatureResults> => {
        if (typeof config.query !== 'string') {
          return { type: 'FeatureCollection', features: [] };
        }
        const query = config.query.trim();
        if (!query) {
          return { type: 'FeatureCollection', features: [] };
        }
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=geojson&limit=5`
        );
        const geo = (await response.json()) as FeatureCollection;
        const features = (geo.features ?? []).map((feature, index) => {
          const props = (feature.properties ?? {}) as Record<string, unknown>;
          const placeName =
            String(props.display_name ?? props.name ?? query).trim() || query;
          const text = String(props.name ?? placeName).trim() || query;
          const bbox =
            feature.bbox && feature.bbox.length >= 4
              ? (feature.bbox.slice(0, 4) as [number, number, number, number])
              : undefined;
          return {
            ...feature,
            id: String((feature.id ?? props.id ?? index) ?? index),
            text,
            place_name: placeName,
            place_type: ['place'],
            bbox
          } as CarmenGeojsonFeature;
        });
        return { type: 'FeatureCollection', features };
      }
    },
    {
      maplibregl: maplibregl,
      placeholder: '搜索地点',
      clearOnBlur: false
    }
  );

  mapInstanceLocal.addControl(geocoder, 'top-left');

  mapInstanceLocal.on('load', () => {
    ensurePoiLayers(mapInstanceLocal);
    ensureIsochroneLayers(mapInstanceLocal);
    ensureRouteLayer(mapInstanceLocal);
    updatePoiSource(poiEngine.value.viewportPoiFC);
    scheduleMapResize();

    if (analysis.value.isochrone) {
      setIsochrones(analysis.value.isochrone);
    }
    if (analysis.value.route) {
      setRoute(analysis.value.route as GeoJSON.Feature<LineString>);
    }
    scheduleViewportQuery();
  });

  mapInstanceLocal.on('click', 'poi-symbol', (event) => {
    if (!event.features?.length) return;
    const feature = event.features[0];
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      return;
    }
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    const props = feature.properties as Record<string, unknown>;
    const poi: POI = {
      id: String(props.id ?? ''),
      name: String(props.name ?? 'POI'),
      type_group: String(props.type_group ?? 'other'),
      originalType: props.originalType as string | undefined,
      lon,
      lat,
      address: props.address as string | undefined
    };
    emit('click-poi', poi);
  });

  mapInstanceLocal.on('click', 'poi-clusters', (event) => {
    if (!event.features?.length) return;
    const feature = event.features[0];
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      return;
    }
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    const zoom = mapInstanceLocal.getZoom();
    mapInstanceLocal.easeTo({
      center: [lng, lat],
      zoom: Math.min(zoom + 2, 18)
    });
  });

  mapInstanceLocal.on('click', (event) => {
    emit('map-click', [event.lngLat.lng, event.lngLat.lat]);
  });

  mapInstanceLocal.on('moveend', () => {
    const center = mapInstanceLocal.getCenter();
    const zoom = mapInstanceLocal.getZoom();
    store.setMapCenter([center.lng, center.lat], zoom);
    scheduleViewportQuery();
  });

  mapInstanceLocal.on('zoomend', () => {
    scheduleViewportQuery();
  });

  mapInstance.value = mapInstanceLocal;
}

onMounted(() => {
  setupMap();
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener('resize', scheduleMapResize);
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = 0;
  }
  mapInstance.value?.remove();
});

watch(
  () => map.value.styleUrl,
  (styleUrl) => {
    const map = mapInstance.value;
    if (!map) return;
    const style = styleUrl && styleUrl.length > 0 ? styleUrl : resolveDefaultStyle();
    map.setStyle(style);
    map.once('styledata', () => {
      ensurePoiLayers(map);
      ensureIsochroneLayers(map);
      ensureRouteLayer(map);
      updatePoiSource(poiEngine.value.viewportPoiFC);
      scheduleMapResize();
      if (analysis.value.isochrone) {
        setIsochrones(analysis.value.isochrone);
      }
      if (analysis.value.route) {
        setRoute(analysis.value.route as GeoJSON.Feature<LineString>);
      }
      scheduleViewportQuery();
    });
  }
);

watch(
  () => poiEngine.value.viewportPoiFC,
  (collection) => {
    updatePoiSource(collection);
  }
);

watch(
  () => analysis.value.isochrone,
  (geojson) => {
    setIsochrones(geojson);
  }
);

watch(
  () => analysis.value.route,
  (feature) => {
    setRoute(feature as GeoJSON.Feature<LineString> | undefined);
  }
);

function getMapDataUrl(): string | undefined {
  const map = mapInstance.value;
  if (!map) return undefined;
  return map.getCanvas().toDataURL('image/png');
}

defineExpose({
  getMapDataUrl
});
</script>

<style scoped>
.map-view {
  position: relative;
  width: 100%;
  height: 100%;
}

.map-canvas {
  position: absolute;
  inset: 0;
}
</style>
