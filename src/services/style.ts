import type { StyleSpecification } from 'maplibre-gl';

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
