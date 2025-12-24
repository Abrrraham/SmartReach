import type { FeatureCollection, Point } from 'geojson';
import type { POI } from '../types/poi';

export interface CsvMapping {
  lonKey: string;
  latKey: string;
  nameKey: string;
  typeKey: string;
  idKey?: string;
  addressKey?: string;
  subcategoryKey?: string;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(',').map((header) => header.trim());
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((cell) => cell.trim());
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    records.push(record);
  }

  return records;
}

export function csvToGeoJSON(text: string, mapping: CsvMapping): FeatureCollection<Point, POI> {
  const records = parseCsv(text);

  const features = records
    .map((record, index) => {
      const lon = Number.parseFloat(record[mapping.lonKey]);
      const lat = Number.parseFloat(record[mapping.latKey]);

      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return undefined;
      }

      const rawType = record[mapping.typeKey];
      const poi: POI = {
        id: record[mapping.idKey ?? 'id'] || `${index}`,
        name: record[mapping.nameKey] || `POI-${index}`,
        type_group: rawType?.trim() ? rawType.trim() : 'other',
        originalType: rawType?.trim() ? rawType.trim() : undefined,
        lon,
        lat,
        address: mapping.addressKey ? record[mapping.addressKey] : undefined,
        subcategory: mapping.subcategoryKey ? record[mapping.subcategoryKey] : undefined
      };

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat]
        },
        properties: poi
      };
    })
    .filter(Boolean) as FeatureCollection<Point, POI>['features'];

  return {
    type: 'FeatureCollection',
    features
  };
}
