export interface POI {
  id: string;
  name: string;
  type_group: string;
  originalType?: string;
  subcategory?: string;
  lon: number;
  lat: number;
  address?: string;
  score?: number;
}
