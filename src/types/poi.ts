export interface POI {
  id: string;
  name: string;
  category:
    | 'medical'
    | 'pharmacy'
    | 'market'
    | 'supermarket'
    | 'convenience'
    | 'education'
    | 'school'
    | 'university'
    | 'bus_stop'
    | 'metro'
    | 'charging'
    | 'park'
    | 'other';
  subcategory?: string;
  lon: number;
  lat: number;
  address?: string;
  score?: number;
}
