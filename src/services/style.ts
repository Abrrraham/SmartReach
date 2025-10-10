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
