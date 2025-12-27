import type { StyleSpecification } from 'maplibre-gl';

const CATEGORY_COLORS: Record<string, string> = {
  medical: '#e03131',
  pharmacy: '#2f9e44',
  market: '#f76707',
  supermarket: '#20c997',
  convenience: '#845ef7',
  education: '#1c7ed6',
  school: '#1c7ed6',
  university: '#364fc7',
  bus_stop: '#1098ad',
  metro: '#0c8599',
  charging: '#12b886',
  park: '#51cf66',
  other: '#adb5bd'
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

const AMAP_RASTER_TUNE = {
  // Visual tuning for dark UI background; adjust if needed.
  saturation: -0.45,
  contrast: 0.18,
  brightnessMin: 0.08,
  brightnessMax: 0.78,
  hueRotate: -8
};

export function buildAmapRasterStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'amap-raster': {
        type: 'raster',
        tiles: [
          'https://wprd01.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7',
          'https://wprd02.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7',
          'https://wprd03.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7',
          'https://wprd04.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7'
        ],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 18,
        attribution: '© 高德地图'
      }
    },
    layers: [
      {
        id: 'amap-raster',
        type: 'raster',
        source: 'amap-raster',
        paint: {
          'raster-saturation': AMAP_RASTER_TUNE.saturation,
          'raster-contrast': AMAP_RASTER_TUNE.contrast,
          'raster-brightness-min': AMAP_RASTER_TUNE.brightnessMin,
          'raster-brightness-max': AMAP_RASTER_TUNE.brightnessMax,
          'raster-hue-rotate': AMAP_RASTER_TUNE.hueRotate
        }
      }
    ]
  };
}
