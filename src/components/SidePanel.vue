<template>
  <aside class="side-panel" aria-label="分析侧栏">
    <header class="side-panel__header">
      <h2>{{ appName }}</h2>
      <p class="side-panel__subtitle">城市可达性工作台</p>
    </header>
    <nav class="tab-list" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="tab-list__item"
        :class="{ 'tab-list__item--active': tab.value === activeTab }"
        type="button"
        role="tab"
        :aria-selected="tab.value === activeTab"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </button>
    </nav>

    <section v-if="activeTab === 'layers'" class="panel-section" aria-label="图层控制">
      <button type="button" class="button button--ghost" @click="fitNanjing">
        定位南京
      </button>

      <h3>POI 类型（分类字段）</h3>
      <div class="button-group button-group--row">
        <button type="button" class="button button--ghost" @click="selectAllGroups">全选</button>
        <button type="button" class="button button--ghost" @click="clearGroups">清空</button>
        <button type="button" class="button button--ghost" @click="invertGroups">反选</button>
      </div>
      <p v-if="poiEngine.buildingIndex" class="helper-text">正在准备 POI...</p>
      <p v-else-if="poiEngine.queryLoading" class="helper-text">正在渲染...</p>
      <p v-else-if="!selectedGroups.length" class="helper-text helper-text--warn">
        未选择任何类型，POI 将不显示。
      </p>
      <div class="checkbox-grid">
        <label v-for="group in sortedGroups" :key="group.id" class="checkbox-item">
          <input
            type="checkbox"
            :value="group.id"
            v-model="selectedGroups"
          />
          <span class="checkbox-item__dot" :style="{ backgroundColor: group.color }" />
          <span>{{ group.label }}</span>
          <span class="checkbox-item__count">{{ group.count }}</span>
        </label>
      </div>
    </section>

    <section v-else-if="activeTab === 'analysis'" class="panel-section" aria-label="分析工具">
      <h3>等时圈</h3>
      <label class="form-label" for="mode-select">出行方式</label>
      <select
        id="mode-select"
        v-model="travelMode"
        class="select-input"
        aria-label="出行方式"
        @change="updateTravelMode"
      >
        <option value="foot-walking">步行</option>
        <option value="cycling-regular">骑行</option>
        <option value="driving-car">驾车</option>
      </select>

      <fieldset class="fieldset">
        <legend>时距 (分钟)</legend>
        <label v-for="timeOption in timeOptions" :key="timeOption.value" class="checkbox-item">
          <input
            type="checkbox"
            :value="timeOption.value"
            :checked="selectedTimes.includes(timeOption.value)"
            @change="toggleTime(timeOption.value)"
          />
          <span>{{ timeOption.label }}</span>
        </label>
      </fieldset>

      <button
        type="button"
        class="button button--primary"
        :disabled="isIsoActionDisabled"
        @click="toggleIsoPick"
      >
        {{ ui.isoPickArmed ? '取消生成' : '生成等时圈' }}
      </button>
      <button type="button" class="button button--ghost" @click="clearIsochrones">
        清除等时圈
      </button>
      <p v-if="iso.loading" class="helper-text">正在生成等时圈...</p>
      <p v-else-if="isoEngine.indexing" class="helper-text">
        正在筛选圈内POI/构建索引...
      </p>
      <p v-else-if="iso.error" class="helper-text helper-text--warn">{{ iso.error }}</p>
      <p v-if="iso.isFallback && iso.geojson" class="helper-text helper-text--warn">
        当前为近似圆（未配置 ORS Key 或服务不可用）
      </p>

      <h3>智能选址</h3>
      <label class="form-label" for="site-group-select">商铺类型</label>
      <select
        id="site-group-select"
        v-model="selectedTargetGroup"
        class="select-input"
      >
        <option value="">请选择类型</option>
        <option v-for="group in siteGroupOptions" :key="group.id" :value="group.id">
          {{ group.label }}
        </option>
      </select>

      <div class="button-group button-group--row">
        <button type="button" class="button button--ghost" @click="toggleBboxPick">
          {{ bboxPickLabel }}
        </button>
        <button type="button" class="button button--ghost" @click="clearSiteSelection">
          清除结果
        </button>
      </div>

      <div v-if="siteEngine.bbox && siteEngine.bboxStats" class="bbox-stats">
        <div class="bbox-stat">
          <span>面积</span>
          <strong>{{ formatKm2(siteEngine.bboxStats.areaKm2) }} km²</strong>
        </div>
        <div class="bbox-stat">
          <span>宽度</span>
          <strong>{{ formatKm(siteEngine.bboxStats.widthKm) }} km</strong>
        </div>
        <div class="bbox-stat">
          <span>高度</span>
          <strong>{{ formatKm(siteEngine.bboxStats.heightKm) }} km</strong>
        </div>
        <div class="bbox-stat">
          <span>POI 总量</span>
          <strong>{{ siteEngine.bboxStats.poiTotal }}</strong>
        </div>
        <div v-if="targetGroupCount !== null" class="bbox-stat">
          <span>目标类数量</span>
          <strong>{{ targetGroupCount }}</strong>
        </div>
      </div>
      <p v-else-if="siteEngine.bbox" class="helper-text">正在统计范围内 POI…</p>
      <p v-else class="helper-text">请先框选分析范围。</p>

      <p v-if="overLimitMessage" class="helper-text helper-text--warn">
        {{ overLimitMessage }}
      </p>

      <button
        type="button"
        class="button button--primary"
        :disabled="isSiteActionDisabled"
        @click="runSiteSelection"
      >
        {{ siteActionLabel }}
      </button>
    </section>

    <section v-else class="panel-section" aria-label="数据管理">
      <h3>上传数据</h3>
      <button type="button" class="button button--secondary" @click="isUploadOpen = true">
        上传 GeoJSON / CSV
      </button>

      <h3>导出</h3>
      <div class="button-group">
      <button type="button" class="button button--ghost" @click="exportPoiCsv">
        导出圈内 CSV
      </button>
        <button type="button" class="button button--ghost" @click="exportMapPng">
          导出地图 PNG
        </button>
      </div>
    </section>

    <UploadModal v-if="isUploadOpen" @close="isUploadOpen = false" @submit="handleUpload" />
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../store/app';
import { GROUP_COLORS, GROUP_LABELS, GROUP_ORDER } from '../utils/poiGroups';
import UploadModal from './UploadModal.vue';

const tabs = [
  { value: 'layers', label: '图层' },
  { value: 'analysis', label: '分析' },
  { value: 'data', label: '数据' }
] as const;

const timeOptions = [
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
  { value: 900, label: '15 分钟' }
] as const;


const emit = defineEmits<{
  (event: 'request-isochrone'): void;
  (event: 'export-poi-csv'): void;
  (event: 'export-map-png'): void;
  (event: 'fit-nanjing'): void;
  (event: 'upload', payload: { type: 'geojson' | 'csv'; data: unknown }): void;
}>();

const activeTab = ref<(typeof tabs)[number]['value']>('layers');
const isUploadOpen = ref(false);
const selectedTimes = ref<number[]>([300, 600, 900]);
const travelMode = ref<'foot-walking' | 'cycling-regular' | 'driving-car'>('foot-walking');

const store = useAppStore();
const { filters, poiEngine, iso, isoEngine, ui, siteEngine } =
  storeToRefs(store);


const appName = computed(() => (import.meta.env.VITE_APP_NAME as string) ?? 'SmartReach');
const isOverlayLoading = computed(() => ui.value.overlay?.type === 'loading');
const isIsoActionDisabled = computed(() => isOverlayLoading.value || iso.value.loading);

const selectedGroups = computed({
  get: () => poiEngine.value.selectedGroups,
  set: (groups: string[]) => {
    store.setSelectedGroups(groups);
  }
});
const sortedGroups = computed(() => {
  if (poiEngine.value.typeCounts.address) {
    console.warn('[poi] address type_group should be filtered out.');
  }
  const counts = poiEngine.value.typeCounts;
  return GROUP_ORDER.filter((id) => id in counts)
    .map((id) => ({
      id,
      count: counts[id] ?? 0,
      label: GROUP_LABELS[id] ?? id,
      color: GROUP_COLORS[id] ?? GROUP_COLORS.other ?? '#64748b'
    }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
});

const siteGroupOptions = computed(() => {
  const counts = poiEngine.value.typeCounts;
  const hasCounts = Object.keys(counts).length > 0;
  const base = hasCounts ? GROUP_ORDER.filter((id) => id in counts) : GROUP_ORDER;
  return base
    .filter((id) => id !== 'address')
    .map((id) => ({
      id,
      label: GROUP_LABELS[id] ?? id,
      count: counts[id] ?? 0
    }));
});

const selectedTargetGroup = computed({
  get: () => siteEngine.value.targetGroupId ?? '',
  set: (value: string) => {
    store.setSiteTargetGroup(value ? value : null);
  }
});

const bboxPickLabel = computed(() => {
  if (ui.value.bboxPickArmed) {
    return '取消框选';
  }
  if (siteEngine.value.bbox) {
    return '重新框选';
  }
  return '框选范围';
});

const siteActionLabel = computed(() =>
  siteEngine.value.results.length ? '重新计算' : '开始选址'
);

const targetGroupCount = computed(() => {
  const stats = siteEngine.value.bboxStats;
  const target = siteEngine.value.targetGroupId;
  if (!stats || !stats.byGroup || !target) {
    return null;
  }
  const value = stats.byGroup[target];
  return typeof value === 'number' ? value : null;
});

const overLimitMessage = computed(() => {
  const stats = siteEngine.value.bboxStats;
  if (!stats) return '';
  const { maxAreaKm2, maxPoi } = siteEngine.value.constraints;
  if (stats.areaKm2 > maxAreaKm2) {
    return `范围过大（>${maxAreaKm2} km²），请缩小范围。`;
  }
  if (stats.poiTotal > maxPoi) {
    return `范围内 POI 过多（>${maxPoi}），请缩小范围。`;
  }
  return '';
});

const isSiteActionDisabled = computed(() => {
  if (!siteEngine.value.bbox) return true;
  if (!siteEngine.value.bboxStats) return true;
  if (!siteEngine.value.targetGroupId) return true;
  if (Boolean(overLimitMessage.value)) return true;
  return siteEngine.value.running;
});


watch(
  () => filters.value.times,
  (times) => {
    selectedTimes.value = [...times];
  },
  { immediate: true }
);

watch(
  () => filters.value.travelMode,
  (mode) => {
    travelMode.value = mode;
  },
  { immediate: true }
);

function selectAllGroups() {
  const ok = window.confirm('全选可能影响性能，是否继续？');
  if (!ok) return;
  store.setSelectedGroups(sortedGroups.value.map((group) => group.id));
}

function clearGroups() {
  store.setSelectedGroups([]);
}

function invertGroups() {
  const current = new Set(poiEngine.value.selectedGroups);
  const next = sortedGroups.value.map((group) => group.id).filter((id) => !current.has(id));
  store.setSelectedGroups(next);
}

function toggleTime(value: number) {
  const exists = selectedTimes.value.includes(value);
  selectedTimes.value = exists
    ? selectedTimes.value.filter((item) => item !== value)
    : [...selectedTimes.value, value].sort((a, b) => a - b);
  store.setTravelTimes(selectedTimes.value);
}

function updateTravelMode() {
  store.setTravelMode(travelMode.value);
}

function toggleBboxPick() {
  if (ui.value.bboxPickArmed) {
    store.cancelBboxPick();
    return;
  }
  store.armBboxPick();
}

function runSiteSelection() {
  store.runSiteSelectionTopN();
}

function clearSiteSelection() {
  store.clearSiteSelection();
}

function formatKm(value: number) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(1);
}

function formatKm2(value: number) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(1);
}


async function handleUpload(payload: { type: 'geojson' | 'csv'; data: unknown }) {
  emit('upload', payload);
  isUploadOpen.value = false;
}

function toggleIsoPick() {
  if (ui.value.isoPickArmed) {
    store.cancelIsoPick();
    return;
  }
  store.armIsoPick();
}

function clearIsochrones() {
  store.clearIsochrones();
}

function exportPoiCsv() {
  emit('export-poi-csv');
}


function exportMapPng() {
  emit('export-map-png');
}

function fitNanjing() {
  emit('fit-nanjing');
}
</script>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
  width: 330px;
  background: var(--panel-bg);
  border-right: 1px solid var(--border-soft);
  box-shadow: 10px 0 28px rgba(2, 6, 23, 0.25);
  backdrop-filter: blur(16px);
  overflow-y: auto;
  position: relative;
}

.side-panel::after {
  content: '';
  position: absolute;
  top: 0;
  right: -1px;
  width: 18px;
  height: 100%;
  background: linear-gradient(90deg, rgba(10, 16, 30, 0.85), rgba(10, 16, 30, 0));
  pointer-events: none;
}

.side-panel__header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.side-panel__subtitle {
  margin: 0;
  color: var(--text-3);
  font-size: 0.9rem;
}

.tab-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.tab-list__item {
  flex: 1 1 0;
  border: 1px solid transparent;
  padding: 0.6rem 0.75rem;
  background: rgba(15, 23, 42, 0.65);
  color: var(--text-3);
  border-radius: 999px;
  cursor: pointer;
  position: relative;
  transition:
    color var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out),
    transform var(--t-fast) var(--ease-out);
}

.tab-list__item::after {
  content: '';
  position: absolute;
  left: 20%;
  right: 20%;
  bottom: 6px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--brand-500), var(--accent-500));
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 200ms var(--ease-out);
}

.tab-list__item--active {
  background: rgba(var(--brand-rgb), 0.16);
  color: var(--text-primary);
  border-color: rgba(var(--brand-rgb), 0.35);
}

.tab-list__item--active::after {
  transform: scaleX(1);
}

.tab-list__item:hover {
  transform: translateY(-1px);
  color: var(--text-secondary);
  border-color: var(--border-strong);
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  animation: tab-fade var(--t-fast) var(--ease-out);
}

.panel-section h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-1);
}

.form-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.text-input,
.select-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--panel-border);
  background: rgba(15, 23, 42, 0.7);
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  font-weight: 600;
  transition:
    transform var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out);
}

.button--primary {
  background: var(--gradient-primary);
  color: var(--text-on-brand);
  box-shadow: 0 10px 24px rgba(var(--brand-rgb), 0.22);
}

.button--secondary {
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--text-primary);
  border-color: rgba(var(--accent-rgb), 0.4);
}

.button--ghost {
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid var(--border-soft);
  color: var(--text-secondary);
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-soft);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.checkbox-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}

.checkbox-item {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  font-size: 0.9rem;
  color: var(--text-secondary);
  padding: 0.35rem 0.5rem;
  border-radius: 10px;
  border: 1px solid transparent;
  background: rgba(15, 23, 42, 0.45);
  transition:
    border-color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out),
    transform var(--t-fast) var(--ease-out);
}

.checkbox-item:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  background: rgba(15, 23, 42, 0.65);
}

.checkbox-item input {
  accent-color: var(--accent-1);
}

.checkbox-item__dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
}

.checkbox-item__count {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.helper-text {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
  padding: 0.45rem 0.6rem 0.45rem 1.5rem;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid var(--border-soft);
  position: relative;
}

.helper-text::before {
  content: '';
  position: absolute;
  left: 0.6rem;
  top: 0.65rem;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--info-500);
}

.helper-text--warn {
  color: var(--warning-500);
  border-color: rgba(var(--warning-rgb), 0.35);
}

.slider-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.slider-group__item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.slider-group__item input {
  width: 100%;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.button-group--row {
  flex-direction: row;
  flex-wrap: wrap;
}

.fieldset {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}


.bbox-stats {
  display: grid;
  gap: 0.4rem;
  padding: 0.75rem;
  border-radius: var(--radius-md);
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid var(--border-soft);
}

.bbox-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.bbox-stat strong {
  font-variant-numeric: tabular-nums;
}
</style>

