export type CoordSys = 'WGS84' | 'GCJ02';

const PI = Math.PI;
const AXIS = 6378245.0;
const OFFSET = 0.00669342162296594323;

function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lon: number, lat: number): number {
  let result =
    -100.0 +
    2.0 * lon +
    3.0 * lat +
    0.2 * lat * lat +
    0.1 * lon * lat +
    0.2 * Math.sqrt(Math.abs(lon));
  result +=
    ((20.0 * Math.sin(6.0 * lon * PI) + 20.0 * Math.sin(2.0 * lon * PI)) * 2.0) /
    3.0;
  result +=
    ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) / 3.0;
  result +=
    ((160.0 * Math.sin((lat / 12.0) * PI) + 320 * Math.sin((lat * PI) / 30.0)) * 2.0) /
    3.0;
  return result;
}

function transformLon(lon: number, lat: number): number {
  let result =
    300.0 +
    lon +
    2.0 * lat +
    0.1 * lon * lon +
    0.1 * lon * lat +
    0.1 * Math.sqrt(Math.abs(lon));
  result +=
    ((20.0 * Math.sin(6.0 * lon * PI) + 20.0 * Math.sin(2.0 * lon * PI)) * 2.0) /
    3.0;
  result +=
    ((20.0 * Math.sin(lon * PI) + 40.0 * Math.sin((lon / 3.0) * PI)) * 2.0) / 3.0;
  result +=
    ((150.0 * Math.sin((lon / 12.0) * PI) + 300.0 * Math.sin((lon / 30.0) * PI)) * 2.0) /
    3.0;
  return result;
}

export function normalizeCoordSys(value: string | undefined, fallback: CoordSys): CoordSys {
  if (!value) return fallback;
  const normalized = value.toUpperCase();
  return normalized === 'GCJ02' ? 'GCJ02' : 'WGS84';
}

export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) {
    return [lon, lat];
  }
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - OFFSET * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((AXIS * (1 - OFFSET)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return [lon + dLon, lat + dLat];
}

export function gcj02ToWgs84(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) {
    return [lon, lat];
  }
  const [lng, latG] = wgs84ToGcj02(lon, lat);
  return [lon * 2 - lng, lat * 2 - latG];
}

export function convertCoord(
  coord: [number, number],
  from: CoordSys,
  to: CoordSys
): [number, number] {
  if (from === to) {
    return coord;
  }
  return from === 'WGS84' ? wgs84ToGcj02(coord[0], coord[1]) : gcj02ToWgs84(coord[0], coord[1]);
}

function convertCoordinates(
  coords: number[] | number[][] | number[][][] | number[][][][],
  from: CoordSys,
  to: CoordSys
): any {
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    return convertCoord([coords[0], coords[1]], from, to);
  }
  return (coords as any[]).map((item) => convertCoordinates(item, from, to));
}

function convertGeometry(
  geometry: GeoJSON.Geometry,
  from: CoordSys,
  to: CoordSys
): GeoJSON.Geometry {
  if (geometry.type === 'GeometryCollection') {
    return {
      ...geometry,
      geometries: geometry.geometries.map((item) => convertGeometry(item, from, to))
    };
  }
  return {
    ...geometry,
    coordinates: convertCoordinates(geometry.coordinates as any, from, to)
  };
}

export function convertFeatureCollection<T extends GeoJSON.FeatureCollection>(
  collection: T,
  from: CoordSys,
  to: CoordSys
): T {
  if (from === to) {
    return collection;
  }
  return {
    ...collection,
    features: collection.features.map((feature) => {
      if (!feature.geometry) {
        return feature;
      }
      return {
        ...feature,
        geometry: convertGeometry(feature.geometry, from, to)
      };
    })
  };
}

export function convertBounds(
  bounds: [[number, number], [number, number]],
  from: CoordSys,
  to: CoordSys
): [[number, number], [number, number]] {
  if (from === to) {
    return bounds;
  }
  return [convertCoord(bounds[0], from, to), convertCoord(bounds[1], from, to)];
}
