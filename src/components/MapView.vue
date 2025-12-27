<template>
  <div class="map-view">
    <div ref="mapContainer" class="map-canvas" aria-label="主地图" />
    <MapHintBar v-if="ui.mapHint" :hint="ui.mapHint" @cancel="handleMapHintCancel" />
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
import type { FeatureCollection, Point, Polygon } from 'geojson';
import type { POI } from '../types/poi';
import { useAppStore } from '../store/app';
import { buildAmapRasterStyle } from '../services/style';
import { GROUP_ALPHA, GROUP_COLORS, GROUP_COLORS_DARK, GROUP_COLORS_LIGHT } from '../utils/poiGroups';
import MapHintBar from './MapHintBar.vue';
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
const ISO_ORIGIN_SOURCE_ID = 'iso-origin';
const ROUTE_SOURCE_ID = 'route';
const ROUTE_ENDPOINT_SOURCE_ID = 'route-endpoint';
const SITE_BBOX_SOURCE_ID = 'site-bbox';
const SITE_BBOX_FILL_ID = 'site-bbox-fill';
const SITE_BBOX_LINE_ID = 'site-bbox-line';
const SITE_RESULT_SOURCE_ID = 'site-results';
const SITE_RESULT_POINT_ID = 'site-result-point';
const SITE_RESULT_LABEL_ID = 'site-result-label';
const SITE_RESULT_HIGHLIGHT_ID = 'site-result-highlight';
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
const ISO_VALUE_EXPR: ExpressionSpecification = [
  'coalesce',
  ['get', 'value'],
  ['get', 'contour'],
  ['get', 'bucket'],
  0
];

const MAP_COLORS = {
  brand: '#38bdf8',
  accent: '#8b5cf6',
  info: '#22d3ee',
  warning: '#f59e0b',
  danger: '#fb7185',
  neutralStroke: 'rgba(6, 10, 20, 0.75)'
};

const emit = defineEmits<{
  (event: 'click-poi', poi: POI): void;
  (event: 'map-click', coordinates: [number, number]): void;
}>();

const mapContainer = ref<HTMLDivElement | null>(null);
const mapInstance = ref<MaplibreMap>();
const store = useAppStore();
const { map, nanjingBounds, analysis, poiEngine, isoEngine, route, ui, siteEngine } =
  storeToRefs(store);
const viewportDebounceMs = 120;
let viewportTimer: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeRaf = 0;
let bboxDragStart: { x: number; y: number } | null = null;
let bboxDragElement: HTMLDivElement | null = null;
let bboxDragging = false;
let bboxDragRaf = 0;
let bboxDragPending: { x: number; y: number } | null = null;

function triggerMapFeedback(
  coordinate: { lng: number; lat: number },
  variant: 'ripple' | 'bounce'
) {
  const map = mapInstance.value;
  const container = mapContainer.value;
  if (!map || !container) return;
  const point = map.project([coordinate.lng, coordinate.lat]);
  const el = document.createElement('div');
  el.className = `map-feedback map-feedback--${variant}`;
  el.style.left = `${point.x}px`;
  el.style.top = `${point.y}px`;
  container.appendChild(el);
  const cleanup = () => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  };
  el.addEventListener('animationend', cleanup);
  window.setTimeout(cleanup, 700);
}

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

function updateMapCursor() {
  const map = mapInstance.value;
  if (!map) return;
  map.getCanvas().style.cursor =
    ui.value.isoPickArmed || ui.value.bboxPickArmed ? 'crosshair' : '';
}

function handleIsoPick(coordinates: [number, number]) {
  store.setIsoOriginFromMapClick(coordinates[0], coordinates[1]);
  store.generateIsochrones(coordinates);
  store.cancelIsoPick();
}

function handleMapHintCancel() {
  if (ui.value.bboxPickArmed) {
    store.cancelBboxPick();
    clearBboxDrag();
    return;
  }
  if (ui.value.isoPickArmed) {
    store.cancelIsoPick();
  }
}

function attachGeocoderSearchButton(
  geocoder: MaplibreGeocoder,
  map: MaplibreMap
) {
  const container = map.getContainer().querySelector(
    '.maplibregl-ctrl-geocoder'
  ) as HTMLElement | null;
  if (!container) return;
  if (container.querySelector('.map-geocoder-search-button')) return;
  const input = container.querySelector(
    '.maplibregl-ctrl-geocoder--input'
  ) as HTMLInputElement | null;
  const actions = container.querySelector(
    '.maplibregl-ctrl-geocoder--pin-right'
  ) as HTMLElement | null;
  if (!input || !actions) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'map-geocoder-search-button';
  button.textContent = '搜索';
  button.setAttribute('aria-label', '搜索');
  button.addEventListener('click', () => {
    const query = input.value.trim();
    if (!query) {
      store.showInfo('请输入搜索内容，例如：新街口、南京站…');
      input.focus();
      return;
    }
    geocoder.query(query);
  });
  actions.prepend(button);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (ui.value.bboxPickArmed) {
      store.cancelBboxPick();
      clearBboxDrag();
      return;
    }
    if (ui.value.isoPickArmed) {
      store.cancelIsoPick();
    }
  }
}

function attachResizeObserver(target?: HTMLElement | null) {
  if (!target) return;
  resizeObserver = new ResizeObserver(() => {
    scheduleMapResize();
  });
  resizeObserver.observe(target);
  window.addEventListener('resize', scheduleMapResize);
}

function resolveRelativePoint(event: MouseEvent) {
  const container = mapContainer.value;
  if (!container) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = container.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function clearBboxDrag() {
  if (bboxDragElement?.parentNode) {
    bboxDragElement.parentNode.removeChild(bboxDragElement);
  }
  bboxDragElement = null;
  bboxDragStart = null;
  bboxDragging = false;
  if (bboxDragRaf) {
    cancelAnimationFrame(bboxDragRaf);
    bboxDragRaf = 0;
  }
  bboxDragPending = null;
  if (mapInstance.value && ui.value.bboxPickArmed) {
    mapInstance.value.dragPan.disable();
  } else {
    mapInstance.value?.dragPan.enable();
  }
}

function handleBboxMouseDown(event: MouseEvent) {
  if (!ui.value.bboxPickArmed) return;
  event.preventDefault();
  const point = resolveRelativePoint(event);
  bboxDragStart = point;
  bboxDragging = true;
  const container = mapContainer.value;
  if (!container) {
    bboxDragging = false;
    bboxDragStart = null;
    return;
  }
  const rect = document.createElement('div');
  rect.className = 'bbox-preview';
  rect.style.left = `${point.x}px`;
  rect.style.top = `${point.y}px`;
  rect.style.width = '0px';
  rect.style.height = '0px';
  container.appendChild(rect);
  bboxDragElement = rect;
  mapInstance.value?.dragPan.disable();
}

function handleBboxMouseMove(event: MouseEvent) {
  if (!ui.value.bboxPickArmed || !bboxDragging || !bboxDragStart || !bboxDragElement) {
    return;
  }
  bboxDragPending = resolveRelativePoint(event);
  if (bboxDragRaf) {
    return;
  }
  bboxDragRaf = requestAnimationFrame(() => {
    bboxDragRaf = 0;
    if (!bboxDragPending || !bboxDragStart || !bboxDragElement) {
      return;
    }
    const point = bboxDragPending;
    bboxDragPending = null;
    const left = Math.min(point.x, bboxDragStart.x);
    const top = Math.min(point.y, bboxDragStart.y);
    const width = Math.abs(point.x - bboxDragStart.x);
    const height = Math.abs(point.y - bboxDragStart.y);
    bboxDragElement.style.left = `${left}px`;
    bboxDragElement.style.top = `${top}px`;
    bboxDragElement.style.width = `${width}px`;
    bboxDragElement.style.height = `${height}px`;
  });
}

function handleBboxMouseUp(event: MouseEvent) {
  if (!ui.value.bboxPickArmed || !bboxDragging || !bboxDragStart) {
    return;
  }
  const point = resolveRelativePoint(event);
  const start = { ...bboxDragStart };
  const width = Math.abs(point.x - bboxDragStart.x);
  const height = Math.abs(point.y - bboxDragStart.y);
  clearBboxDrag();
  if (width < 4 || height < 4) {
    return;
  }
  const map = mapInstance.value;
  if (!map) {
    return;
  }
  const startLngLat = map.unproject([start.x, start.y]);
  const endLngLat = map.unproject([point.x, point.y]);
  const minLng = Math.min(startLngLat.lng, endLngLat.lng);
  const minLat = Math.min(startLngLat.lat, endLngLat.lat);
  const maxLng = Math.max(startLngLat.lng, endLngLat.lng);
  const maxLat = Math.max(startLngLat.lat, endLngLat.lat);
  store.setSiteBbox([minLng, minLat, maxLng, maxLat]);
  store.cancelBboxPick();
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
const emptyOriginCollection: FeatureCollection<Point, Record<string, unknown>> = {
  type: 'FeatureCollection',
  features: []
};
const emptyRouteCollection: FeatureCollection = {
  type: 'FeatureCollection',
  features: []
};
const emptySiteResultCollection: FeatureCollection<Point, Record<string, unknown>> = {
  type: 'FeatureCollection',
  features: []
};
const emptySiteBboxCollection: FeatureCollection<Polygon, Record<string, unknown>> = {
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
  const color = GROUP_COLORS[group] ?? GROUP_COLORS.other ?? '#64748b';
  const colorLight = GROUP_COLORS_LIGHT[group] ?? color;
  const colorDark = GROUP_COLORS_DARK[group] ?? color;
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
        'fill-opacity': GROUP_ALPHA.fill
      }
    });
  }
  if (includeHull && !map.getLayer(hullLineId(group))) {
    map.addLayer({
      id: hullLineId(group),
      type: 'line',
      source: hullId,
      paint: {
        'line-color': colorDark,
        'line-width': 1.2,
        'line-opacity': 0.75
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
        'circle-color': colorLight,
        'circle-radius': CLUSTER_HALO_EXPR,
        'circle-opacity': 0.18,
        'circle-blur': 0.85
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
        'circle-opacity': 0.75,
        'circle-stroke-color': colorDark,
        'circle-stroke-width': 1.6,
        'circle-stroke-opacity': 0.75
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
        'text-halo-color': 'rgba(6, 10, 20, 0.65)',
        'text-halo-width': 1.6
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
        'circle-radius': 5.5,
        'circle-stroke-width': 1.6,
        'circle-stroke-color': MAP_COLORS.neutralStroke,
        'circle-stroke-opacity': 0.8,
        'circle-color': color
      }
    });
  }

  if (hasGroup) {
    return;
  }

  const clusterHandler = async (event: maplibregl.MapLayerMouseEvent) => {
    if (ui.value.isoPickArmed || ui.value.bboxPickArmed) {
      return;
    }
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
    if (ui.value.isoPickArmed || ui.value.bboxPickArmed) {
      return;
    }
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
        'fill-color': [
          'interpolate',
          ['linear'],
          ISO_VALUE_EXPR,
          300,
          '#7dd3fc',
          600,
          MAP_COLORS.brand,
          900,
          '#0ea5e9'
        ],
        'fill-opacity': ['interpolate', ['linear'], ISO_VALUE_EXPR, 300, 0.28, 900, 0.12]
      }
    });

    map.addLayer({
      id: 'isochrones-outline',
      type: 'line',
      source: ISOCHRONE_SOURCE_ID,
      paint: {
        'line-color': MAP_COLORS.brand,
        'line-width': ['interpolate', ['linear'], ISO_VALUE_EXPR, 300, 2.2, 900, 1.1],
        'line-opacity': ['interpolate', ['linear'], ISO_VALUE_EXPR, 300, 0.8, 900, 0.4]
      }
    });
  }
}

function ensureIsoOriginLayers(map: MaplibreMap) {
  if (!map.getSource(ISO_ORIGIN_SOURCE_ID)) {
    map.addSource(ISO_ORIGIN_SOURCE_ID, {
      type: 'geojson',
      data: emptyOriginCollection
    });

    map.addLayer({
      id: 'iso-origin-halo',
      type: 'circle',
      source: ISO_ORIGIN_SOURCE_ID,
      paint: {
        'circle-radius': 14,
        'circle-color': '#7dd3fc',
        'circle-opacity': 0.22
      }
    });

    map.addLayer({
      id: 'iso-origin-point',
      type: 'circle',
      source: ISO_ORIGIN_SOURCE_ID,
      paint: {
        'circle-radius': 8,
        'circle-color': MAP_COLORS.brand,
        'circle-stroke-width': 2,
        'circle-stroke-color': MAP_COLORS.neutralStroke,
        'circle-stroke-opacity': 0.8
      }
    });

    map.addLayer({
      id: 'iso-origin-label',
      type: 'symbol',
      source: ISO_ORIGIN_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': 12,
        'text-offset': [0, 1.2]
      },
      paint: {
        'text-color': MAP_COLORS.brand,
        'text-halo-color': 'rgba(6, 10, 20, 0.75)',
        'text-halo-width': 1.2
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
      id: 'route-casing',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': 'rgba(6, 10, 20, 0.7)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 10],
        'line-opacity': 0.8
      }
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': MAP_COLORS.warning,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6],
        'line-opacity': 0.9
      }
    });
  }
}

function ensureRouteEndpointLayer(map: MaplibreMap) {
  if (!map.getSource(ROUTE_ENDPOINT_SOURCE_ID)) {
    map.addSource(ROUTE_ENDPOINT_SOURCE_ID, {
      type: 'geojson',
      data: emptyOriginCollection
    });

    map.addLayer({
      id: 'route-endpoint-halo',
      type: 'circle',
      source: ROUTE_ENDPOINT_SOURCE_ID,
      paint: {
        'circle-radius': 12,
        'circle-color': '#fed7aa',
        'circle-opacity': 0.28
      }
    });

    map.addLayer({
      id: 'route-endpoint-point',
      type: 'circle',
      source: ROUTE_ENDPOINT_SOURCE_ID,
      paint: {
        'circle-radius': 7,
        'circle-color': MAP_COLORS.warning,
        'circle-stroke-width': 2,
        'circle-stroke-color': MAP_COLORS.neutralStroke,
        'circle-stroke-opacity': 0.8
      }
    });
  }
}

function ensureSiteBboxLayers(map: MaplibreMap) {
  if (!map.getSource(SITE_BBOX_SOURCE_ID)) {
    map.addSource(SITE_BBOX_SOURCE_ID, {
      type: 'geojson',
      data: emptySiteBboxCollection
    });
    map.addLayer({
      id: SITE_BBOX_FILL_ID,
      type: 'fill',
      source: SITE_BBOX_SOURCE_ID,
      paint: {
        'fill-color': MAP_COLORS.accent,
        'fill-opacity': 0.12
      }
    });
    map.addLayer({
      id: SITE_BBOX_LINE_ID,
      type: 'line',
      source: SITE_BBOX_SOURCE_ID,
      paint: {
        'line-color': '#a855f7',
        'line-width': 2.2,
        'line-opacity': 0.85
      }
    });
  }
}

function setSiteBbox(bbox?: [number, number, number, number] | null) {
  const map = mapInstance.value;
  if (!map) return;
  ensureSiteBboxLayers(map);
  const source = map.getSource(SITE_BBOX_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;
  if (!bbox) {
    source.setData(emptySiteBboxCollection);
    return;
  }
  const [minLng, minLat, maxLng, maxLat] = bbox;
  source.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat]
            ]
          ]
        },
        properties: {}
      }
    ]
  } as FeatureCollection<Polygon, Record<string, unknown>>);
}

function ensureSiteResultLayers(map: MaplibreMap) {
  if (!map.getSource(SITE_RESULT_SOURCE_ID)) {
    map.addSource(SITE_RESULT_SOURCE_ID, {
      type: 'geojson',
      data: emptySiteResultCollection
    });
    map.addLayer({
      id: SITE_RESULT_POINT_ID,
      type: 'circle',
      source: SITE_RESULT_SOURCE_ID,
      paint: {
        'circle-radius': 8,
        'circle-color': '#f472b6',
        'circle-stroke-color': MAP_COLORS.neutralStroke,
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.8
      }
    });
    map.addLayer({
      id: SITE_RESULT_HIGHLIGHT_ID,
      type: 'circle',
      source: SITE_RESULT_SOURCE_ID,
      filter: ['==', ['get', 'rank'], -1],
      paint: {
        'circle-radius': 12,
        'circle-color': '#fbbf24',
        'circle-stroke-color': MAP_COLORS.neutralStroke,
        'circle-stroke-width': 2.5,
        'circle-opacity': 0.9
      }
    });
    map.addLayer({
      id: SITE_RESULT_LABEL_ID,
      type: 'symbol',
      source: SITE_RESULT_SOURCE_ID,
      layout: {
        'text-field': ['get', 'rank'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': 12,
        'text-offset': [0, 0]
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(6, 10, 20, 0.65)',
        'text-halo-width': 1.4
      }
    });
  }
}

function setSiteResults(results: Array<{ rank: number; lng: number; lat: number; total: number }>) {
  const map = mapInstance.value;
  if (!map) return;
  ensureSiteResultLayers(map);
  const source = map.getSource(SITE_RESULT_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;
  if (!results.length) {
    source.setData(emptySiteResultCollection);
    return;
  }
  source.setData({
    type: 'FeatureCollection',
    features: results.map((item) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [item.lng, item.lat]
      },
      properties: {
        rank: item.rank,
        total: item.total
      }
    }))
  } as FeatureCollection<Point, Record<string, unknown>>);
}

function updateSiteResultHighlight(rank: number | null) {
  const map = mapInstance.value;
  if (!map) return;
  if (!map.getLayer(SITE_RESULT_HIGHLIGHT_ID)) {
    ensureSiteResultLayers(map);
  }
  const filter = typeof rank === 'number' ? ['==', ['get', 'rank'], rank] : ['==', ['get', 'rank'], -1];
  map.setFilter(SITE_RESULT_HIGHLIGHT_ID, filter as any);
}

function focusSiteResult(rank: number | null) {
  if (typeof rank !== 'number') return;
  const target = siteEngine.value.results.find((item) => item.rank === rank);
  if (!target) return;
  const map = mapInstance.value;
  if (!map) return;
  const nextZoom = Math.max(map.getZoom(), 14);
  map.easeTo({
    center: [target.lng, target.lat],
    zoom: nextZoom
  });
  map.once('moveend', () => {
    triggerMapFeedback({ lng: target.lng, lat: target.lat }, 'ripple');
  });
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

function setIsoOrigin(origin?: { lng: number; lat: number }, active?: boolean) {
  const map = mapInstance.value;
  if (!map) return;
  ensureIsoOriginLayers(map);

  const source = map.getSource(ISO_ORIGIN_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) {
    return;
  }
  if (active && origin) {
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [origin.lng, origin.lat]
          },
          properties: {
            label: '起点'
          }
        }
      ]
    } as FeatureCollection<Point, Record<string, unknown>>);
  } else {
    source.setData(emptyOriginCollection);
  }
}

function setRoute(geojson?: FeatureCollection) {
  const map = mapInstance.value;
  if (!map) return;
  ensureRouteLayer(map);

  const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
  if (source) {
    source.setData(geojson ?? emptyRouteCollection);
  }
}

function setRouteEndpoint(end?: { lng: number; lat: number }, active?: boolean) {
  const map = mapInstance.value;
  if (!map) return;
  ensureRouteEndpointLayer(map);
  const source = map.getSource(ROUTE_ENDPOINT_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;
  if (active && end) {
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [end.lng, end.lat]
          },
          properties: {}
        }
      ]
    } as FeatureCollection<Point, Record<string, unknown>>);
  } else {
    source.setData(emptyOriginCollection);
  }
}

function setupMap() {
  if (!mapContainer.value) return;

  logBasemapConfig();
  const mapOptions: maplibregl.MapOptions & { preserveDrawingBuffer?: boolean } = {
    container: mapContainer.value,
    style: buildInitialStyle(),
    center: map.value.center as LngLatLike,
    zoom: map.value.zoom,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // Keep drawing buffer so PNG export can read the canvas.
    preserveDrawingBuffer: true
  };
  const mapInstanceLocal = new maplibregl.Map(mapOptions);

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
  requestAnimationFrame(() => attachGeocoderSearchButton(geocoder, mapInstanceLocal));

  mapInstanceLocal.on('load', () => {
    ensureIsochroneLayers(mapInstanceLocal);
    ensureIsoOriginLayers(mapInstanceLocal);
    ensureRouteLayer(mapInstanceLocal);
    ensureSiteBboxLayers(mapInstanceLocal);
    ensureSiteResultLayers(mapInstanceLocal);
    syncGroupLayers(mapInstanceLocal);
    store.setMapReady(true);
    scheduleMapResize();
    mapInstanceLocal.once('idle', () => {
      requestAnimationFrame(() => reportViewport(mapInstanceLocal));
    });

    if (analysis.value.isochrone) {
      setIsochrones(analysis.value.isochrone);
    }
    if (isoEngine.value.active) {
      setIsoOrigin(isoEngine.value.origin, isoEngine.value.active);
    }
    if (route.value.geojson) {
      setRoute(route.value.geojson);
    }
    if (route.value.active) {
      setRouteEndpoint(route.value.end, route.value.active);
    }
    setSiteBbox(siteEngine.value.bbox);
    setSiteResults(siteEngine.value.results);
    updateSiteResultHighlight(siteEngine.value.selectedRank);
    scheduleViewportQuery();
  });

  mapInstanceLocal.on('click', (event) => {
    if (ui.value.bboxPickArmed) {
      return;
    }
    if (ui.value.isoPickArmed) {
      handleIsoPick([event.lngLat.lng, event.lngLat.lat]);
      return;
    }
    emit('map-click', [event.lngLat.lng, event.lngLat.lat]);
  });

  mapInstanceLocal.on('click', SITE_RESULT_POINT_ID, (event) => {
    if (ui.value.bboxPickArmed || ui.value.isoPickArmed) {
      return;
    }
    const feature = event.features?.[0];
    const rank = Number((feature?.properties as { rank?: number } | undefined)?.rank);
    if (Number.isFinite(rank)) {
      store.selectSiteResult(rank);
    }
  });

  mapInstanceLocal.on('click', SITE_RESULT_LABEL_ID, (event) => {
    if (ui.value.bboxPickArmed || ui.value.isoPickArmed) {
      return;
    }
    const feature = event.features?.[0];
    const rank = Number((feature?.properties as { rank?: number } | undefined)?.rank);
    if (Number.isFinite(rank)) {
      store.selectSiteResult(rank);
    }
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
  updateMapCursor();
}

onMounted(() => {
  setupMap();
  window.addEventListener('keydown', handleKeydown);
  mapContainer.value?.addEventListener('mousedown', handleBboxMouseDown);
  window.addEventListener('mousemove', handleBboxMouseMove);
  window.addEventListener('mouseup', handleBboxMouseUp);
});

onBeforeUnmount(() => {
  clearBboxDrag();
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
  window.removeEventListener('keydown', handleKeydown);
  mapContainer.value?.removeEventListener('mousedown', handleBboxMouseDown);
  window.removeEventListener('mousemove', handleBboxMouseMove);
  window.removeEventListener('mouseup', handleBboxMouseUp);
});

  watch(
    () => map.value.styleUrl,
    (styleUrl) => {
      const map = mapInstance.value;
      if (!map) return;
      const style = styleUrl && styleUrl.length > 0 ? styleUrl : resolveDefaultStyle();
      map.setStyle(style);
      map.once('style.load', () => {
        syncGroupLayers(map);
        ensureIsochroneLayers(map);
        ensureIsoOriginLayers(map);
        ensureRouteLayer(map);
        ensureSiteBboxLayers(map);
        ensureSiteResultLayers(map);
        refreshGroupData(map);
        scheduleMapResize();
        if (analysis.value.isochrone) {
          setIsochrones(analysis.value.isochrone);
        }
        if (isoEngine.value.active) {
          setIsoOrigin(isoEngine.value.origin, isoEngine.value.active);
        }
        if (route.value.geojson) {
          setRoute(route.value.geojson);
        }
        if (route.value.active) {
          setRouteEndpoint(route.value.end, route.value.active);
        }
        setSiteBbox(siteEngine.value.bbox);
        setSiteResults(siteEngine.value.results);
        updateSiteResultHighlight(siteEngine.value.selectedRank);
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
    () => [ui.value.isoPickArmed, ui.value.bboxPickArmed],
    () => {
      updateMapCursor();
      const map = mapInstance.value;
      if (map) {
        if (ui.value.bboxPickArmed) {
          map.dragPan.disable();
        } else {
          map.dragPan.enable();
        }
      }
      if (!ui.value.bboxPickArmed) {
        clearBboxDrag();
      }
    }
  );

watch(
  () => analysis.value.isochrone,
  (geojson) => {
    setIsochrones(geojson);
    if (geojson && isoEngine.value.origin) {
      requestAnimationFrame(() => {
        if (isoEngine.value.origin) {
          triggerMapFeedback(isoEngine.value.origin, 'bounce');
        }
      });
    }
  }
);

watch(
  () => [isoEngine.value.active, isoEngine.value.origin?.lng, isoEngine.value.origin?.lat],
  () => {
    setIsoOrigin(isoEngine.value.origin, isoEngine.value.active);
  }
);

watch(
  () => route.value.geojson,
  (geojson) => {
    setRoute(geojson);
  }
);

watch(
  () => [route.value.active, route.value.end?.lng, route.value.end?.lat],
  () => {
    setRouteEndpoint(route.value.end, route.value.active);
  }
);

watch(
  () => siteEngine.value.bbox,
  (bbox) => {
    setSiteBbox(bbox);
  }
);

watch(
  () => siteEngine.value.results,
  (results) => {
    setSiteResults(results);
    updateSiteResultHighlight(siteEngine.value.selectedRank);
  },
  { deep: true }
);

watch(
  () => siteEngine.value.selectedRank,
  (rank) => {
    updateSiteResultHighlight(rank);
    focusSiteResult(rank);
  }
);

function getMapDataUrl(): Promise<string | undefined> {
  const map = mapInstance.value;
  if (!map) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const capture = () => {
      const canvas = map.getCanvas();
      const output = document.createElement('canvas');
      output.width = canvas.width;
      output.height = canvas.height;
      const ctx = output.getContext('2d');
      if (!ctx) {
        resolve(undefined);
        return;
      }
      try {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, output.width, output.height);
        ctx.drawImage(canvas, 0, 0);
        resolve(output.toDataURL('image/png'));
      } catch (error) {
        console.warn('[map] export failed', error);
        resolve(undefined);
      }
    };
    if (map.isStyleLoaded()) {
      map.once('idle', capture);
      map.triggerRepaint();
    } else {
      map.once('load', () => {
        map.once('idle', capture);
        map.triggerRepaint();
      });
    }
  });
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

:deep(.bbox-preview) {
  position: absolute;
  border: 2px dashed rgba(var(--brand-rgb), 0.8);
  background: rgba(var(--brand-rgb), 0.15);
  pointer-events: none;
  z-index: 15;
}

:deep(.map-feedback) {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 16;
}

:deep(.map-feedback--ripple) {
  border: 1px solid rgba(var(--brand-rgb), 0.85);
  animation: map-ripple 300ms var(--ease-out);
}

:deep(.map-feedback--bounce) {
  background: rgba(var(--brand-rgb), 0.85);
  animation: map-bounce 250ms var(--ease-out);
}

@keyframes map-ripple {
  from {
    transform: translate(-50%, -50%) scale(0.4);
    opacity: 0.9;
  }
  to {
    transform: translate(-50%, -50%) scale(2.4);
    opacity: 0;
  }
}

@keyframes map-bounce {
  0% {
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    transform: translate(-50%, -62%) scale(1.12);
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
  }
}
</style>
