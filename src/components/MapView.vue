<template>
  <div class="map-view">
    <div ref="mapContainer" class="map-canvas" aria-label="主地图" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import maplibregl, { Map, GeoJSONSource, LngLatLike } from 'maplibre-gl';
import MaplibreGeocoder from '@maplibre/maplibre-gl-geocoder';
import { storeToRefs } from 'pinia';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { POI } from '../types/poi';
import { useAppStore } from '../store/app';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';

const FALLBACK_STYLE = {
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
const { map, nanjingBounds, filteredPoisFeatureCollection, analysis } = storeToRefs(store);

function buildInitialStyle() {
  return map.value.styleUrl && map.value.styleUrl.length > 0 ? map.value.styleUrl : FALLBACK_STYLE;
}

function ensurePoiLayers(map: Map) {
  if (map.getSource(POI_SOURCE_ID)) {
    return;
  }

  map.addSource(POI_SOURCE_ID, {
    type: 'geojson',
    data: filteredPoisFeatureCollection.value,
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 14
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
        ['get', 'category'],
        'medical',
        '#e03131',
        'pharmacy',
        '#2f9e44',
        'market',
        '#f76707',
        'supermarket',
        '#20c997',
        'convenience',
        '#845ef7',
        'education',
        '#1c7ed6',
        'school',
        '#1c7ed6',
        'university',
        '#364fc7',
        'bus_stop',
        '#1098ad',
        'metro',
        '#0c8599',
        'charging',
        '#12b886',
        'park',
        '#51cf66',
        '#adb5bd'
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

function updatePoiSource(collection: FeatureCollection<Point>) {
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

  const mapInstanceLocal = new maplibregl.Map({
    container: mapContainer.value,
    style: buildInitialStyle(),
    center: map.value.center as LngLatLike,
    zoom: map.value.zoom,
    maxBounds: nanjingBounds.value
  });

  mapInstanceLocal.addControl(new maplibregl.NavigationControl(), 'top-right');

  const geocoder = new MaplibreGeocoder(
    {
      forwardGeocode: async (config) => {
        if (!config.query) return { features: [] };
        const query = config.query.trim();
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=geojson&limit=5`
        );
        const geo = (await response.json()) as FeatureCollection;
        return geo;
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
    updatePoiSource(filteredPoisFeatureCollection.value);

    if (analysis.value.isochrone) {
      setIsochrones(analysis.value.isochrone);
    }
    if (analysis.value.route) {
      setRoute(analysis.value.route as GeoJSON.Feature<LineString>);
    }
  });

  mapInstanceLocal.on('click', 'poi-symbol', (event) => {
    if (!event.features?.length) return;
    const feature = event.features[0];
    const poi = feature.properties as unknown as POI;
    emit('click-poi', poi);
  });

  mapInstanceLocal.on('click', (event) => {
    emit('map-click', [event.lngLat.lng, event.lngLat.lat]);
  });

  mapInstanceLocal.on('moveend', () => {
    const center = mapInstanceLocal.getCenter();
    const zoom = mapInstanceLocal.getZoom();
    store.setMapCenter([center.lng, center.lat], zoom);
  });

  mapInstance.value = mapInstanceLocal;
}

onMounted(() => {
  setupMap();
});

onBeforeUnmount(() => {
  mapInstance.value?.remove();
});

watch(
  () => map.value.styleUrl,
  (styleUrl) => {
    const map = mapInstance.value;
    if (!map) return;
    const style = styleUrl && styleUrl.length > 0 ? styleUrl : FALLBACK_STYLE;
    map.setStyle(style);
    map.once('styledata', () => {
      ensurePoiLayers(map);
      ensureIsochroneLayers(map);
      ensureRouteLayer(map);
      updatePoiSource(filteredPoisFeatureCollection.value);
      if (analysis.value.isochrone) {
        setIsochrones(analysis.value.isochrone);
      }
      if (analysis.value.route) {
        setRoute(analysis.value.route as GeoJSON.Feature<LineString>);
      }
    });
  }
);

watch(
  filteredPoisFeatureCollection,
  (collection) => {
    updatePoiSource(collection);
  },
  { deep: true }
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
