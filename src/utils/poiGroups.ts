export const GROUP_LABELS: Record<string, string> = {
  food: '餐饮',
  shopping: '购物',
  life_service: '生活服务',
  medical: '医疗健康',
  education_culture: '科教文化',
  transport: '交通出行',
  lodging: '住宿',
  finance: '金融',
  government: '政府与社会组织',
  company: '公司企业',
  entertainment_sports: '文体娱乐',
  tourism: '旅游景点',
  public_facility: '公共设施',
  residential_realestate: '住宅房产',
  other: '其他'
};

export const GROUP_PALETTE: Record<
  string,
  { main: string; light: string; dark: string }
> = {
  food: { main: '#f97316', light: '#fed7aa', dark: '#c2410c' },
  shopping: { main: '#14b8a6', light: '#99f6e4', dark: '#0f766e' },
  life_service: { main: '#f59e0b', light: '#fde68a', dark: '#b45309' },
  medical: { main: '#fb7185', light: '#fecdd3', dark: '#be123c' },
  education_culture: { main: '#60a5fa', light: '#bfdbfe', dark: '#1d4ed8' },
  transport: { main: '#38bdf8', light: '#bae6fd', dark: '#0284c7' },
  lodging: { main: '#a855f7', light: '#e9d5ff', dark: '#7e22ce' },
  finance: { main: '#818cf8', light: '#c7d2fe', dark: '#4f46e5' },
  government: { main: '#94a3b8', light: '#e2e8f0', dark: '#475569' },
  company: { main: '#22d3ee', light: '#a5f3fc', dark: '#0e7490' },
  entertainment_sports: { main: '#e879f9', light: '#f5d0fe', dark: '#a21caf' },
  tourism: { main: '#22c55e', light: '#bbf7d0', dark: '#15803d' },
  public_facility: { main: '#f472b6', light: '#fbcfe8', dark: '#be185d' },
  residential_realestate: { main: '#c084fc', light: '#e9d5ff', dark: '#7c3aed' },
  other: { main: '#64748b', light: '#cbd5f5', dark: '#334155' }
};

const buildColorMap = (key: 'main' | 'light' | 'dark') =>
  Object.fromEntries(
    Object.entries(GROUP_PALETTE).map(([group, palette]) => [group, palette[key]])
  ) as Record<string, string>;

export const GROUP_COLORS = buildColorMap('main');
export const GROUP_COLORS_LIGHT = buildColorMap('light');
export const GROUP_COLORS_DARK = buildColorMap('dark');
export const GROUP_ALPHA = {
  fill: 0.12,
  soft: 0.2,
  strong: 0.35
};

export const GROUP_ORDER = [
  'food',
  'shopping',
  'life_service',
  'medical',
  'education_culture',
  'transport',
  'lodging',
  'finance',
  'government',
  'company',
  'entertainment_sports',
  'tourism',
  'public_facility',
  'residential_realestate',
  'other'
];
