import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const ROOT = process.cwd();
const INPUT_CANDIDATES = [
  path.join(ROOT, 'public', 'data', 'type.xlsx'),
  path.join(ROOT, 'data', 'type.xlsx')
];
const OUTPUT_RULES = path.join(ROOT, 'public', 'data', 'type_rules.generated.json');
const OUTPUT_REPORT = path.join(ROOT, 'public', 'data', 'type_coverage_report.md');

const TYPE_GROUPS = [
  { id: 'food', label: '餐饮' },
  { id: 'shopping', label: '购物' },
  { id: 'life_service', label: '生活服务' },
  { id: 'medical', label: '医疗健康' },
  { id: 'education_culture', label: '科教文化' },
  { id: 'transport', label: '交通出行' },
  { id: 'lodging', label: '住宿' },
  { id: 'finance', label: '金融' },
  { id: 'government', label: '政府与社会组织' },
  { id: 'company', label: '公司企业' },
  { id: 'entertainment_sports', label: '文体娱乐' },
  { id: 'tourism', label: '旅游景点' },
  { id: 'public_facility', label: '公共设施' },
  { id: 'residential_realestate', label: '住宅房产' },
  { id: 'address', label: '地名地址' },
  { id: 'other', label: '其他' }
];

const L1_MAP = {
  餐饮服务: 'food',
  购物服务: 'shopping',
  生活服务: 'life_service',
  医疗保健服务: 'medical',
  科教文化服务: 'education_culture',
  交通设施服务: 'transport',
  汽车服务: 'transport',
  汽车销售: 'transport',
  汽车维修: 'transport',
  汽车租赁: 'transport',
  住宿服务: 'lodging',
  金融保险服务: 'finance',
  政府机构及社会团体: 'government',
  公司企业: 'company',
  体育休闲服务: 'entertainment_sports',
  风景名胜: 'tourism',
  公共设施: 'public_facility',
  公共设施服务: 'public_facility',
  商务住宅: 'residential_realestate',
  地名地址信息: 'address',
  室内设施: 'public_facility'
};

const L2_OVERRIDES = [
  {
    l1: '生活服务',
    match: ['邮局', '公厕', '公共厕所', '公用电话', '垃圾站', '供水', '供电', '通信'],
    group: 'public_facility'
  }
];

const PRIORITY = [
  'medical',
  'transport',
  'public_facility',
  'education_culture',
  'finance',
  'lodging',
  'shopping',
  'food',
  'life_service',
  'entertainment_sports',
  'tourism',
  'government',
  'company',
  'residential_realestate',
  'address',
  'other'
];

const TYPE_KEY_CANDIDATES = [
  'type',
  'poi_type',
  'poiType',
  'category',
  '类别',
  '分类',
  '大类',
  '小类',
  'type_name'
];

const SEGMENT_SPLIT = /[|｜]+/g;
const LEVEL_SPLIT = /[;；]+/g;

function findInputPath() {
  return INPUT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}

function normalizeKey(key) {
  return String(key).trim().toLowerCase();
}

function pickTypeKey(rows) {
  if (!rows.length) return '';
  const keyMap = new Map();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      keyMap.set(normalizeKey(key), key);
    });
  });
  for (const candidate of TYPE_KEY_CANDIDATES) {
    const match = keyMap.get(normalizeKey(candidate));
    if (match) return match;
  }
  return Object.keys(rows[0])[0];
}

function cleanRawType(raw) {
  return String(raw)
    .trim()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*]/g, '')
    .replace(/\s+/g, ' ');
}

function splitSegments(raw) {
  return cleanRawType(raw)
    .split(SEGMENT_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLevels(segment) {
  return segment
    .split(LEVEL_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickByPriority(groups) {
  const priorityIndex = new Map(PRIORITY.map((id, index) => [id, index]));
  let winner = 'other';
  let winnerIndex = priorityIndex.get('other') ?? PRIORITY.length;
  groups.forEach((group) => {
    const index = priorityIndex.get(group);
    if (index !== undefined && index < winnerIndex) {
      winner = group;
      winnerIndex = index;
    }
  });
  return winner;
}

function applyOverrides(l1, l2, l3) {
  for (const override of L2_OVERRIDES) {
    if (override.l1 !== l1) continue;
    const hit = override.match.some((token) => l2.includes(token) || l3.includes(token));
    if (hit) return override.group;
  }
  return undefined;
}

function classifyType(rawType) {
  const raw = cleanRawType(rawType);
  if (!raw) return 'other';
  const segments = splitSegments(raw);
  if (!segments.length) return 'other';
  const groups = segments.map((segment) => {
    const [l1 = '', l2 = '', l3 = ''] = splitLevels(segment);
    if (!l1) return 'other';
    const baseGroup = L1_MAP[l1];
    if (!baseGroup) return 'other';
    return applyOverrides(l1, l2, l3) ?? baseGroup;
  });
  return pickByPriority(groups);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sortEntries(map) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

const inputPath = findInputPath();
if (!inputPath) {
  console.error('[type:report] type.xlsx not found in public/data or data.');
  process.exit(1);
}

const workbook = xlsx.readFile(inputPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
if (!rows.length) {
  console.error('[type:report] type.xlsx has no rows.');
  process.exit(1);
}

const typeKey = pickTypeKey(rows);
const rawTypes = rows
  .map((row) => cleanRawType(row[typeKey]))
  .filter(Boolean);

const totalRows = rawTypes.length;
const typeCounts = new Map();
rawTypes.forEach((raw) => {
  typeCounts.set(raw, (typeCounts.get(raw) ?? 0) + 1);
});

const uniqueTypes = typeCounts.size;
const top200 = sortEntries(typeCounts).slice(0, 200);

const coverageCounts = new Map(TYPE_GROUPS.map((group) => [group.id, 0]));
const otherTop = new Map();

for (const [raw, count] of typeCounts.entries()) {
  const group = classifyType(raw);
  coverageCounts.set(group, (coverageCounts.get(group) ?? 0) + count);
  if (group === 'other') {
    otherTop.set(raw, count);
  }
}

const coverageRows = TYPE_GROUPS.map((group) => {
  const count = coverageCounts.get(group.id) ?? 0;
  const ratio = totalRows ? ((count / totalRows) * 100).toFixed(2) : '0';
  return {
    id: group.id,
    label: group.label,
    count,
    ratio
  };
});

const otherTop100 = sortEntries(otherTop).slice(0, 100);

ensureDir(OUTPUT_RULES);
fs.writeFileSync(
  OUTPUT_RULES,
  JSON.stringify(
    {
      version: 2,
      groups: TYPE_GROUPS,
      l1Map: L1_MAP,
      l2Overrides: L2_OVERRIDES,
      priority: PRIORITY,
      meta: {
        generatedAt: new Date().toISOString(),
        source: path.relative(ROOT, inputPath),
        totalRows,
        uniqueTypes
      }
    },
    null,
    2
  ),
  'utf-8'
);

const reportLines = [
  '# Type Coverage Report',
  '',
  `Source: ${path.relative(ROOT, inputPath)}`,
  `Generated at: ${new Date().toISOString()}`,
  '',
  `Total rows: ${totalRows}`,
  `Unique types: ${uniqueTypes}`,
  '',
  '## Coverage by type_group',
  '',
  '| type_group | label | count | ratio |',
  '| --- | --- | --- | --- |',
  ...coverageRows.map((row) => `| ${row.id} | ${row.label} | ${row.count} | ${row.ratio}% |`),
  '',
  '## Top 200 raw types',
  '',
  ...top200.map(([raw, count], index) => `${index + 1}. ${raw} (${count})`),
  '',
  '## Other top 100 raw types',
  '',
  ...otherTop100.map(([raw, count], index) => `${index + 1}. ${raw} (${count})`)
];

ensureDir(OUTPUT_REPORT);
fs.writeFileSync(OUTPUT_REPORT, reportLines.join('\n'), 'utf-8');

console.info('[type:report] done', {
  input: path.relative(ROOT, inputPath),
  totalRows,
  uniqueTypes,
  rulesOutput: path.relative(ROOT, OUTPUT_RULES),
  reportOutput: path.relative(ROOT, OUTPUT_REPORT)
});
