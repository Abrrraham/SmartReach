import axios from 'axios';
import { buffer, lineString, point, featureCollection, distance as turfDistance } from '@turf/turf';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { TravelProfile } from '../utils/spatial';

interface IsochroneParams {
  lon: number;
  lat: number;
  profile: TravelProfile;
  ranges: number[];
}

interface DirectionsParams {
  start: [number, number];
  end: [number, number];
  profile: TravelProfile;
}

interface MatrixParams {
  locations: [number, number][];
  profile: TravelProfile;
}

export interface MatrixResponseShape {
  durations: number[][];
  distances?: number[][];
}

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2';
const SPEED_LUT: Record<TravelProfile, number> = {
  'foot-walking': 5,
  'cycling-regular': 15,
  'driving-car': 40
};

const orsKey = import.meta.env.VITE_ORS_KEY;
const hasApiKey = Boolean(orsKey && orsKey.trim().length > 0);

export async function isochrones(params: IsochroneParams): Promise<FeatureCollection> {
  if (!hasApiKey) {
    return localIsochrones(params);
  }

  try {
    const { lon, lat, profile, ranges } = params;
    const response = await axios.post<FeatureCollection>(
      `${ORS_BASE_URL}/isochrones/${profile}`,
      {
        locations: [[lon, lat]],
        range: ranges
      },
      {
        headers: {
          Authorization: orsKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data?.features?.length) {
      return response.data;
    }
  } catch (error) {
    console.warn('[ors] isochrones fallback triggered', error);
  }

  return localIsochrones(params);
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
  const polygons = ranges.map((rangeSeconds) => {
    const distanceKm = (speed * rangeSeconds) / 3600;
    const buffered = buffer(origin, distanceKm, { units: 'kilometers' });
    buffered.properties = {
      contour: rangeSeconds,
      areaKm2: Math.PI * distanceKm * distanceKm
    };
    return buffered;
  });

  return featureCollection(polygons);
}

function localDirections({ start, end, profile }: DirectionsParams): Feature<LineString> {
  const speed = SPEED_LUT[profile];
  const line = lineString([start, end], {
    profile,
    mode: 'fallback'
  });
  const km = turfDistance(point(start), point(end), { units: 'kilometers' });
  line.properties = {
    distance: km * 1000,
    duration: (km / speed) * 3600,
    summary: {
      distance: km * 1000,
      duration: (km / speed) * 3600
    }
  };
  return line;
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
