import { point, featureCollection, pointsWithinPolygon, distance as turfDistance, bbox as turfBbox } from '@turf/turf';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { POI } from '../types/poi';

export type TravelProfile = 'foot-walking' | 'cycling-regular' | 'driving-car';

export interface TravelEstimation {
  poi: POI;
  distanceKm: number;
  durationMin: number;
}

export interface SitingWeights {
  demand: number;
  accessibility: number;
  density: number;
  constraint: number;
}

export type CandidateWithMetrics = POI & {
  metrics?: Partial<Record<keyof SitingWeights, number>>;
};

const DEFAULT_BBOX: [[number, number], [number, number]] = [
  [118.3, 31.3],
  [119.3, 32.6]
];

const DEFAULT_SPEEDS: Record<TravelProfile, number> = {
  'foot-walking': 5,
  'cycling-regular': 15,
  'driving-car': 40
};

export function bboxOfNanjing(): [[number, number], [number, number]] {
  return DEFAULT_BBOX;
}

export function withinIsochrone(pois: POI[], isochrone?: FeatureCollection): POI[] {
  if (!isochrone || !pois.length) {
    return [];
  }

  const [minX, minY, maxX, maxY] = turfBbox(
    isochrone as FeatureCollection<Polygon | MultiPolygon>
  );
  const candidates = pois.filter(
    (poi) => poi.lon >= minX && poi.lon <= maxX && poi.lat >= minY && poi.lat <= maxY
  );
  if (!candidates.length) {
    return [];
  }

  const poiFeatures = featureCollection(
    candidates.map((p) =>
      point([p.lon, p.lat], {
        ...p
      })
    )
  );

  const hits = pointsWithinPolygon(poiFeatures, isochrone as FeatureCollection<Polygon | MultiPolygon>);

  return hits.features.map((feature) => feature.properties as POI);
}

export function nearestByTimeOrDistance(
  start: [number, number],
  candidates: POI[],
  strategy: 'time' | 'distance',
  matrix?: { durations?: number[][]; distances?: number[][] },
  profile: TravelProfile = 'foot-walking'
): TravelEstimation[] {
  if (!candidates.length) {
    return [];
  }

  const baseSpeed = DEFAULT_SPEEDS[profile];
  const fallbackSpeed = baseSpeed > 0 ? baseSpeed : DEFAULT_SPEEDS['foot-walking'];

  const durationRow = matrix?.durations?.[0];
  const distanceRow = matrix?.distances?.[0];

  const estimations = candidates.map((poi, index) => {
    const euclideanKm =
      distanceRow && typeof distanceRow[index + 1] === 'number'
        ? distanceRow[index + 1] / 1000
        : turfDistance(point(start), point([poi.lon, poi.lat]), { units: 'kilometers' });

    const durationMinutes =
      durationRow && typeof durationRow[index + 1] === 'number'
        ? durationRow[index + 1] / 60
        : (euclideanKm / fallbackSpeed) * 60;

    return {
      poi,
      distanceKm: euclideanKm,
      durationMin: durationMinutes
    };
  });

  const comparator =
    strategy === 'distance'
      ? (a: TravelEstimation, b: TravelEstimation) => a.distanceKm - b.distanceKm
      : (a: TravelEstimation, b: TravelEstimation) => a.durationMin - b.durationMin;

  return estimations.sort(comparator);
}

export function scoring(
  candidates: CandidateWithMetrics[],
  weights: SitingWeights
): Array<{ poi: POI; score: number }> {
  if (!candidates.length) {
    return [];
  }

  const keys = ['demand', 'accessibility', 'density', 'constraint'] as const;
  const sumWeights = keys.reduce((sum, key) => sum + Math.max(weights[key], 0), 0);
  const normalisedWeights = keys.reduce<Record<(typeof keys)[number], number>>((acc, key) => {
    if (sumWeights === 0) {
      acc[key] = 0.25;
    } else {
      acc[key] = Math.max(weights[key], 0) / sumWeights;
    }
    return acc;
  }, {} as Record<(typeof keys)[number], number>);

  const metricExtents = keys.reduce<Record<(typeof keys)[number], { min: number; max: number }>>(
    (result, key) => {
      const values = candidates.map((candidate) => candidate.metrics?.[key] ?? 0);
      const min = Math.min(...values);
      const max = Math.max(...values);
      result[key] = { min, max };
      return result;
    },
    {} as Record<(typeof keys)[number], { min: number; max: number }>
  );

  const scored = candidates.map((candidate) => {
    const total = keys.reduce((acc, key) => {
      const extent = metricExtents[key];
      const rawValue = candidate.metrics?.[key] ?? 0;
      const normalised =
        extent.max - extent.min === 0
          ? 0.5
          : (rawValue - extent.min) / (extent.max - extent.min);
      return acc + normalised * normalisedWeights[key];
    }, 0);

    return {
      poi: candidate,
      score: Math.round(Math.min(Math.max(total * 100, 0), 100))
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
