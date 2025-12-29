import { normalizeCoordSys, type CoordSys } from '../utils/coord';

const DEFAULT_CENTER_FALLBACK: [number, number] = [118.796, 32.06];

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCenter(value: string | undefined, fallback: [number, number]): [number, number] {
  if (!value) return fallback;
  const [lonRaw, latRaw] = value.split(',');
  const lon = Number.parseFloat(lonRaw ?? '');
  const lat = Number.parseFloat(latRaw ?? '');
  return [
    Number.isFinite(lon) ? lon : fallback[0],
    Number.isFinite(lat) ? lat : fallback[1]
  ];
}

export const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'SmartReach';
export const DEFAULT_CITY = (import.meta.env.VITE_DEFAULT_CITY as string | undefined) ?? '南京市';
export const DEFAULT_CENTER = parseCenter(
  import.meta.env.VITE_DEFAULT_CENTER as string | undefined,
  DEFAULT_CENTER_FALLBACK
);
export const DEFAULT_ZOOM = parseNumber(import.meta.env.VITE_DEFAULT_ZOOM as string | undefined, 11);
export const MAP_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
export const POI_URL =
  (import.meta.env.VITE_POI_URL as string | undefined) ?? '/data/nanjing_poi.json';
export const RULES_URL =
  (import.meta.env.VITE_RULES_URL as string | undefined) ?? '/data/type_rules.generated.json';
export const ORS_KEY = (import.meta.env.VITE_ORS_KEY as string | undefined) ?? '';
export const AMAP_KEY = (import.meta.env.VITE_AMAP_KEY as string | undefined) ?? '';
export const HAS_AMAP_KEY = AMAP_KEY.trim().length > 0;

export const BASEMAP_PROVIDER = (
  (import.meta.env.VITE_BASEMAP_PROVIDER as string | undefined) ?? 'amap'
).toLowerCase();
export const MAP_COORD_SYS: CoordSys = normalizeCoordSys(
  import.meta.env.VITE_COORD_SYS as string | undefined,
  BASEMAP_PROVIDER === 'osm' ? 'WGS84' : 'GCJ02'
);
export const POI_COORD_SYS: CoordSys = normalizeCoordSys(
  import.meta.env.VITE_POI_COORD_SYS as string | undefined,
  'WGS84'
);

const MIN_ZOOM_CAP = 7;
const MIN_ZOOM_DEFAULT = 3;
const MAX_ZOOM_DEFAULT = 18;
const MIN_ZOOM_RAW = parseNumber(import.meta.env.VITE_MIN_ZOOM as string | undefined, MIN_ZOOM_DEFAULT);
const MAX_ZOOM_RAW = parseNumber(import.meta.env.VITE_MAX_ZOOM as string | undefined, MAX_ZOOM_DEFAULT);

export const MIN_ZOOM = Math.max(0, Math.min(MIN_ZOOM_RAW, MIN_ZOOM_CAP));
export const MAX_ZOOM = Math.max(MAX_ZOOM_RAW, MAX_ZOOM_DEFAULT);

export const DEBUG_ACCESS =
  import.meta.env.DEV && (import.meta.env.VITE_DEBUG_ACCESS as string | undefined) === '1';
export const IS_DEV = import.meta.env.DEV;
export const BASE_URL = (import.meta.env.BASE_URL as string | undefined) ?? '/';
