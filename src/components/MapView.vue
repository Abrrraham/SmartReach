<template>
  <div class="map-view">
    <div ref="mapContainer" class="map-canvas" aria-label="主地图" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import maplibregl, {
  Map as MaplibreMap,
  GeoJSONSource,
  LngLatBoundsLike,
  LngLatLike,
  type ExpressionSpecification
} from 'maplibre-gl';
import MaplibreGeocoder, {
  type CarmenGeojsonFeature,
  type MaplibreGeocoderFeatureResults
} from '@maplibre/maplibre-gl-geocoder';
import { storeToRefs } from 'pinia';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import type { POI } from '../types/poi';
import { useAppStore } from '../store/app';
import { buildAmapRasterStyle } from '../services/style';
import { GROUP_COLORS } from '../utils/poiGroups';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';

const BASEMAP_PROVIDER = (
  (import.meta.env.VITE_BASEMAP_PROVIDER as string | undefined) ?? 'amap'
).toLowerCase();
const ENV_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
const AMAP_KEY = (import.meta.env.VITE_AMAP_KEY as string | undefined) ?? '';
const HAS_AMAP_KEY = AMAP_KEY.trim().length > 0;
const MIN_ZOOM_RAW = Number.parseFloat(
  (import.meta.env.VITE_MIN_ZOOM as string | undefined) ?? '3'
);
const MAX_ZOOM_RAW = Number.parseFloat(
  (import.meta.env.VITE_MAX_ZOOM as string | undefined) ?? '18'
);
const MIN_ZOOM_CAP = 7;
const MIN_ZOOM_DEFAULT = 3;
const MAX_ZOOM_DEFAULT = 18;
const MIN_ZOOM = Number.isFinite(MIN_ZOOM_RAW)
  ? Math.max(0, Math.min(MIN_ZOOM_RAW, MIN_ZOOM_CAP))
  : MIN_ZOOM_DEFAULT;
const MAX_ZOOM = Number.isFinite(MAX_ZOOM_RAW)
  ? Math.max(MAX_ZOOM_RAW, MAX_ZOOM_DEFAULT)
  : MAX_ZOOM_DEFAULT;

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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

const ISOCHRONE_SOURCE_ID = 'isochrones';
const ROUTE_SOURCE_ID = 'route';
const POINT_SOURCE_PREFIX = 'poi';
const HULL_SOURCE_PREFIX = 'hull';
const CLUSTER_RADIUS_MIN = 12;
const CLUSTER_RADIUS_MAX = 56;
const CLUSTER_RADIUS_EXPR: ExpressionSpecification = [
  'min',
  CLUSTER_RADIUS_MAX,
  [
    'max',
    CLUSTER_RADIUS_MIN,
    [
      'interpolate',
      ['linear'],
      ['get', 'point_count'],
      1,
      CLUSTER_RADIUS_MIN,
      10,
      16,
      50,
      22,
      200,
      30,
      1000,
      42,
      5000,
      CLUSTER_RADIUS_MAX
    ]
  ]
];
const CLUSTER_HALO_EXPR: ExpressionSpecification = [
  '+',
  CLUSTER_RADIUS_EXPR,
  6
];

const emit = defineEmits<{
  (event: 'click-poi', poi: POI): void;
  (event: 'map-click', coordinates: [number, number]): void;
}>();

const mapContainer = ref<HTMLDivElement | null>(null);
const mapInstance = ref<MaplibreMap>();
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
    store.updateViewport(bbox, zoom);
    store.requestViewportPois(bbox, zoom);
  }, viewportDebounceMs);
}

function resolveDefaultStyle(): maplibregl.StyleSpecification {
  return BASEMAP_PROVIDER === 'osm' ? OSM_STYLE : AMAP_STYLE;
}

function reportViewport(map: MaplibreMap) {
  const bounds = map.getBounds();
  const bbox: [number, number, number, number] = [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth()
  ];
  const zoom = Math.floor(map.getZoom());
  store.updateViewport(bbox, zoom);
  store.requestViewportPois(bbox, zoom);
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

function logZoomDebug(map: MaplibreMap) {
  if (!import.meta.env.DEV) return;
  console.info('[map] zoom debug', {
    zoom: map.getZoom(),
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
    maxBounds: map.getMaxBounds()?.toArray?.() ?? null,
    scrollZoom: map.scrollZoom.isEnabled(),
    dragPan: map.dragPan.isEnabled(),
    doubleClickZoom: map.doubleClickZoom.isEnabled(),
    touchZoomRotate: map.touchZoomRotate.isEnabled()
  });
  (window as Window & { __map?: MaplibreMap }).__map = map;
}

const emptyPointCollection: FeatureCollection<Point, Record<string, unknown>> = {
  type: 'FeatureCollection',
  features: []
};
const emptyHullCollection: FeatureCollection<Polygon, Record<string, unknown>> = {
  type: 'FeatureCollection',
  features: []
};
const activeGroups = new Set<string>();
const DEV_LOG = import.meta.env.DEV;
const logPoiLayer = (message: string, payload?: Record<string, unknown>) => {
  if (!DEV_LOG) return;
  console.info('[poi-layer]', message, payload ?? {});
};
const clusterHandlers = new Map<string, (event: maplibregl.MapLayerMouseEvent) => void>();
const pointHandlers = new Map<string, (event: maplibregl.MapLayerMouseEvent) => void>();

function pointSourceId(group: string) {
  return `${POINT_SOURCE_PREFIX}-${group}`;
}

function hullSourceId(group: string) {
  return `${HULL_SOURCE_PREFIX}-${group}`;
}

function clusterCircleId(group: string) {
  return `cluster-circle-${group}`;
}

function clusterLabelId(group: string) {
  return `cluster-label-${group}`;
}

function pointCircleId(group: string) {
  return `point-circle-${group}`;
}

function hullFillId(group: string) {
  return `hull-fill-${group}`;
}

function hullLineId(group: string) {
  return `hull-line-${group}`;
}

function removeHullLayers(map: MaplibreMap, group: string) {
  const layers = [hullLineId(group), hullFillId(group)];
  layers.forEach((id) => {
    if (map.getLayer(id)) {
      map.removeLayer(id);
    }
  });
  const sourceId = hullSourceId(group);
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

function ensureGroupLayers(map: MaplibreMap, group: string, includeHull: boolean) {
  const hasGroup = activeGroups.has(group);
  const color = GROUP_COLORS[group] ?? '#868e96';
  const pointId = pointSourceId(group);
  const hullId = hullSourceId(group);
  if (!map.getSource(pointId)) {
    map.addSource(pointId, {
      type: 'geojson',
      data: emptyPointCollection
    });
  }
  if (includeHull && !map.getSource(hullId)) {
    map.addSource(hullId, {
      type: 'geojson',
      data: emptyHullCollection
    });
  }

  if (!includeHull) {
    removeHullLayers(map, group);
  }
  if (includeHull && !map.getLayer(hullFillId(group))) {
    map.addLayer({
      id: hullFillId(group),
      type: 'fill',
      source: hullId,
      paint: {
        'fill-color': color,
        'fill-opacity': 0.15
      }
    });
  }
  if (includeHull && !map.getLayer(hullLineId(group))) {
    map.addLayer({
      id: hullLineId(group),
      type: 'line',
      source: hullId,
      paint: {
        'line-color': color,
        'line-width': 1
      }
    });
  }
  const haloId = `cluster-halo-${group}`;
  if (!map.getLayer(haloId)) {
    map.addLayer({
      id: haloId,
      type: 'circle',
      source: pointId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': color,
        'circle-radius': CLUSTER_HALO_EXPR,
        'circle-opacity': 0.2,
        'circle-blur': 0.8
      }
    });
  }
  if (!map.getLayer(clusterCircleId(group))) {
    map.addLayer({
      id: clusterCircleId(group),
      type: 'circle',
      source: pointId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': color,
        'circle-radius': CLUSTER_RADIUS_EXPR,
        'circle-opacity': 0.65,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.9
      }
    });
  }
  if (!map.getLayer(clusterLabelId(group))) {
    map.addLayer({
      id: clusterLabelId(group),
      type: 'symbol',
      source: pointId,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': 12
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.35)',
        'text-halo-width': 1.4
      }
    });
  }
  if (!map.getLayer(pointCircleId(group))) {
    map.addLayer({
      id: pointCircleId(group),
      type: 'circle',
      source: pointId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 6,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-color': color
      }
    });
  }

  if (hasGroup) {
    return;
  }

  const clusterHandler = async (event: maplibregl.MapLayerMouseEvent) => {
    if (!event.features?.length) return;
    const feature = event.features[0];
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      return;
    }
    const props = feature.properties as Record<string, unknown>;
    const clusterId = Number((props as { cluster_id?: number }).cluster_id);
    if (!Number.isFinite(clusterId)) {
      return;
    }
    const zoom = await store.expandCluster(group, clusterId);
    if (typeof zoom !== 'number') {
      return;
    }
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    map.easeTo({
      center: [lng, lat],
      zoom
    });
  };
  const pointHandler = (event: maplibregl.MapLayerMouseEvent) => {
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
      type_group: String(props.type_group ?? group),
      lon,
      lat
    };
    emit('click-poi', poi);
  };
  map.on('click', clusterCircleId(group), clusterHandler);
  map.on('click', pointCircleId(group), pointHandler);
  clusterHandlers.set(group, clusterHandler);
  pointHandlers.set(group, pointHandler);
  activeGroups.add(group);
  logPoiLayer('ensure', { group });
}

function removeGroupLayers(map: MaplibreMap, group: string) {
  const clusterHandler = clusterHandlers.get(group);
  if (clusterHandler) {
    map.off('click', clusterCircleId(group), clusterHandler);
    clusterHandlers.delete(group);
  }
  const pointHandler = pointHandlers.get(group);
  if (pointHandler) {
    map.off('click', pointCircleId(group), pointHandler);
    pointHandlers.delete(group);
  }
  const layerIds = [
    pointCircleId(group),
    clusterLabelId(group),
    `cluster-halo-${group}`,
    clusterCircleId(group),
    hullLineId(group),
    hullFillId(group)
  ];
  layerIds.forEach((id) => {
    if (map.getLayer(id)) {
      map.removeLayer(id);
    }
  });
  const sources = [pointSourceId(group), hullSourceId(group)];
  sources.forEach((id) => {
    if (map.getSource(id)) {
      map.removeSource(id);
    }
  });
  activeGroups.delete(group);
}

function updateGroupData(
  map: MaplibreMap,
  group: string,
  points: FeatureCollection<Point, Record<string, unknown>>,
  hulls: FeatureCollection<Polygon, Record<string, unknown>>,
  includeHull: boolean
) {
  const pointId = pointSourceId(group);
  const hullId = hullSourceId(group);
  if (!map.getSource(pointId) || (includeHull && !map.getSource(hullId))) {
    ensureGroupLayers(map, group, includeHull);
  }
  const pointSource = map.getSource(pointId) as GeoJSONSource | undefined;
  if (pointSource) {
    pointSource.setData(points);
  }
  if (includeHull) {
    const hullSource = map.getSource(hullId) as GeoJSONSource | undefined;
    if (hullSource) {
      hullSource.setData(hulls);
    }
  }
  logPoiLayer('setData', {
    group,
    points: points.features.length,
    hulls: includeHull ? hulls.features.length : 0
  });
}

function ensureIsochroneLayers(map: MaplibreMap) {
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

function ensureRouteLayer(map: MaplibreMap) {
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

function syncGroupLayers(map: MaplibreMap) {
  const selected = new Set(poiEngine.value.selectedGroups);
  const includeHull = poiEngine.value.showClusterExtent;
  activeGroups.forEach((group) => {
    if (!selected.has(group)) {
      removeGroupLayers(map, group);
    }
  });
  selected.forEach((group) => {
    ensureGroupLayers(map, group, includeHull);
    const points = poiEngine.value.poiByGroup[group] ?? emptyPointCollection;
    const hulls = poiEngine.value.hullByGroup[group] ?? emptyHullCollection;
    updateGroupData(map, group, points, hulls, includeHull);
  });
}

function refreshGroupData(map: MaplibreMap) {
  const includeHull = poiEngine.value.showClusterExtent;
  activeGroups.forEach((group) => {
    const points = poiEngine.value.poiByGroup[group] ?? emptyPointCollection;
    const hulls = poiEngine.value.hullByGroup[group] ?? emptyHullCollection;
    updateGroupData(map, group, points, hulls, includeHull);
  });
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
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM
  });

  const resizeTarget = mapContainer.value?.parentElement ?? mapContainer.value;
  attachResizeObserver(resizeTarget);
  logZoomDebug(mapInstanceLocal);

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
    ensureIsochroneLayers(mapInstanceLocal);
    ensureRouteLayer(mapInstanceLocal);
    syncGroupLayers(mapInstanceLocal);
    store.setMapReady(true);
    scheduleMapResize();
    mapInstanceLocal.once('idle', () => {
      requestAnimationFrame(() => reportViewport(mapInstanceLocal));
    });

    if (analysis.value.isochrone) {
      setIsochrones(analysis.value.isochrone);
    }
    if (analysis.value.route) {
      setRoute(analysis.value.route as GeoJSON.Feature<LineString>);
    }
    scheduleViewportQuery();
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
        syncGroupLayers(map);
        ensureIsochroneLayers(map);
        ensureRouteLayer(map);
        refreshGroupData(map);
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
    () => poiEngine.value.selectedGroups,
    () => {
      const map = mapInstance.value;
      if (!map) return;
      syncGroupLayers(map);
      if (poiEngine.value.selectedGroups.length) {
        scheduleViewportQuery();
      }
    },
    { deep: true }
  );

  watch(
    () => poiEngine.value.poiByGroup,
    () => {
      const map = mapInstance.value;
      if (!map) return;
      refreshGroupData(map);
    },
    { deep: true }
  );

  watch(
    () => poiEngine.value.hullByGroup,
    () => {
      const map = mapInstance.value;
      if (!map) return;
      refreshGroupData(map);
    },
    { deep: true }
  );

  watch(
    () => poiEngine.value.showClusterExtent,
    () => {
      const map = mapInstance.value;
      if (!map) return;
      syncGroupLayers(map);
      refreshGroupData(map);
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

function fitToNanjing() {
  const map = mapInstance.value;
  if (!map) return;
  map.fitBounds(nanjingBounds.value as LngLatBoundsLike, { padding: 20, duration: 800 });
}

defineExpose({
  getMapDataUrl,
  fitToNanjing
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
