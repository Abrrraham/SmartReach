import axios from 'axios';
import { buffer, lineString, point, featureCollection, distance as turfDistance } from '@turf/turf';
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { TravelProfile } from '../utils/spatial';

interface IsochroneParams {
  lon: number;
  lat: number;
  profile: TravelProfile;
  ranges: number[];
  signal?: AbortSignal;
}

interface DirectionsParams {
  start: [number, number];
  end: [number, number];
  profile: TravelProfile;
  signal?: AbortSignal;
}

interface MatrixParams {
  locations: [number, number][];
  profile: TravelProfile;
}

export interface MatrixResponseShape {
  durations: number[][];
  distances?: number[][];
}

export interface IsochroneResult {
  data: FeatureCollection;
  isFallback: boolean;
  error?: 'missing_key' | 'service_error' | 'limit' | 'auth';
  status?: number;
  statusText?: string;
  responseText?: string;
}

export interface DirectionsStep {
  instruction: string;
  distance: number;
  duration: number;
}

export interface DirectionsSummary {
  distance: number;
  duration: number;
}

export interface DirectionsGeojsonResult {
  data: FeatureCollection;
  summary?: DirectionsSummary;
  steps?: DirectionsStep[];
  isFallback: boolean;
  error?: 'missing_key' | 'service_error' | 'limit' | 'auth';
  status?: number;
}

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2';
const SPEED_LUT: Record<TravelProfile, number> = {
  'foot-walking': 5,
  'cycling-regular': 15,
  'driving-car': 40
};

const orsKey = import.meta.env.VITE_ORS_KEY;
const hasApiKey = Boolean(orsKey && orsKey.trim().length > 0);

function isAbortError(error: unknown): boolean {
  if (axios.isCancel?.(error)) {
    return true;
  }
  if (error && typeof error === 'object') {
    const maybeError = error as { name?: string; code?: string };
    return maybeError.name === 'CanceledError' || maybeError.code === 'ERR_CANCELED';
  }
  return false;
}

export async function isochrones(params: IsochroneParams): Promise<IsochroneResult> {
  if (!hasApiKey) {
    return {
      data: localIsochrones(params),
      isFallback: true,
      error: 'missing_key'
    };
  }

  try {
    const { lon, lat, profile, ranges } = params;
    const response = await axios.post<FeatureCollection>(
      `${ORS_BASE_URL}/isochrones/${profile}`,
      {
        locations: [[lon, lat]],
        range_type: 'time',
        range: ranges,
        location_type: 'start',
        smoothing: 0.5,
        attributes: ['area']
      },
      {
        headers: {
          Authorization: orsKey,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/geo+json, application/json'
        },
        signal: params.signal
      }
    );

    if (response.data?.features?.length) {
      return {
        data: response.data,
        isFallback: false
      };
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const statusText = axios.isAxiosError(error) ? error.response?.statusText : undefined;
    const responseText = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? '').slice(0, 300)
      : undefined;
    console.warn('[ors] isochrones fallback triggered', { status, statusText });
    return {
      data: localIsochrones(params),
      isFallback: true,
      error: status === 429 ? 'limit' : status === 401 || status === 403 ? 'auth' : 'service_error',
      status,
      statusText,
      responseText
    };
  }

  return {
    data: localIsochrones(params),
    isFallback: true,
    error: 'service_error'
  };
}

export async function directions(params: DirectionsParams): Promise<Feature<LineString>> {
  if (!hasApiKey) {
    return localDirections(params);
  }

  try {
    const response = await axios.post<{ features: Feature<LineString>[] }>(
      `${ORS_BASE_URL}/directions/${params.profile}`,
      {
        coordinates: [params.start, params.end],
        instructions: false
      },
      {
        headers: {
          Authorization: orsKey,
          'Content-Type': 'application/json'
        }
      }
    );

    const feature = response.data?.features?.[0];
    if (feature) {
      return feature;
    }
  } catch (error) {
    console.warn('[ors] directions fallback triggered', error);
  }

  return localDirections(params);
}

export async function directionsGeojson(params: DirectionsParams): Promise<DirectionsGeojsonResult> {
  if (!hasApiKey) {
    const local = localDirectionsResult(params);
    return {
      data: local.data,
      summary: local.summary,
      steps: local.steps,
      isFallback: true,
      error: 'missing_key'
    };
  }

  try {
    const response = await axios.post<FeatureCollection>(
      `${ORS_BASE_URL}/directions/${params.profile}/geojson`,
      {
        coordinates: [params.start, params.end],
        preference: 'fastest',
        instructions: true
      },
      {
        headers: {
          Authorization: orsKey,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json, application/geo+json'
        },
        signal: params.signal
      }
    );

    const feature = response.data?.features?.[0] as Feature<
      LineString | MultiLineString,
      Record<string, any>
    > | undefined;
    if (feature) {
      const summary = feature.properties?.summary as DirectionsSummary | undefined;
      const segments = Array.isArray(feature.properties?.segments)
        ? feature.properties?.segments
        : [];
      const steps = segments
        .flatMap((segment: any) => Array.isArray(segment?.steps) ? segment.steps : [])
        .map((step: any) => ({
          instruction: String(step?.instruction ?? ''),
          distance: Number(step?.distance ?? 0),
          duration: Number(step?.duration ?? 0)
        }))
        .filter((step: DirectionsStep) => step.instruction);
      return {
        data: response.data,
        summary,
        steps,
        isFallback: false
      };
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const local = localDirectionsResult(params);
    return {
      data: local.data,
      summary: local.summary,
      steps: local.steps,
      isFallback: true,
      error: status === 429 ? 'limit' : status === 401 || status === 403 ? 'auth' : 'service_error',
      status
    };
  }

  const local = localDirectionsResult(params);
  return {
    data: local.data,
    summary: local.summary,
    steps: local.steps,
    isFallback: true,
    error: 'service_error'
  };
}

export async function matrix(params: MatrixParams): Promise<MatrixResponseShape> {
  if (!hasApiKey) {
    return localMatrix(params);
  }

  try {
    const response = await axios.post<MatrixResponseShape>(
      `${ORS_BASE_URL}/matrix/${params.profile}`,
      {
        locations: params.locations,
        metrics: ['duration', 'distance']
      },
      {
        headers: {
          Authorization: orsKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data?.durations) {
      return response.data;
    }
  } catch (error) {
    console.warn('[ors] matrix fallback triggered', error);
  }

  return localMatrix(params);
}

function localIsochrones({ lon, lat, profile, ranges }: IsochroneParams): FeatureCollection {
  const speed = SPEED_LUT[profile];
  const origin = point([lon, lat]);
  const polygons = ranges
    .map((rangeSeconds) => {
    const distanceKm = (speed * rangeSeconds) / 3600;
    const buffered = buffer(origin, distanceKm, { units: 'kilometers' });
    if (!buffered) {
      return undefined;
    }
    buffered.properties = {
      value: rangeSeconds,
      contour: rangeSeconds,
      areaKm2: Math.PI * distanceKm * distanceKm
    };
    return buffered;
  })
    .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature));

  return featureCollection(polygons);
}

function localDirections({ start, end, profile }: DirectionsParams): Feature<LineString> {
  const speed = SPEED_LUT[profile];
  const line = lineString([start, end]);
  const km = turfDistance(point(start), point(end), { units: 'kilometers' });
  line.properties = {
    profile,
    mode: 'fallback',
    distance: km * 1000,
    duration: (km / speed) * 3600,
    summary: {
      distance: km * 1000,
      duration: (km / speed) * 3600
    }
  };
  return line;
}

function localDirectionsResult({ start, end, profile }: DirectionsParams): {
  data: FeatureCollection;
  summary?: DirectionsSummary;
  steps?: DirectionsStep[];
} {
  const line = localDirections({ start, end, profile });
  const summary = (line.properties as { summary?: DirectionsSummary } | undefined)?.summary;
  return {
    data: featureCollection([line]),
    summary,
    steps: undefined
  };
}

function localMatrix({ locations, profile }: MatrixParams): MatrixResponseShape {
  const speed = SPEED_LUT[profile];
  const origin = locations[0];
  const durations: number[][] = [[]];
  const distances: number[][] = [[]];

  locations.forEach((location, index) => {
    const km = turfDistance(point(origin), point(location), { units: 'kilometers' });
    const duration = (km / speed) * 3600;
    durations[0][index] = duration;
    distances[0][index] = km * 1000;
  });

  return { durations, distances };
}
