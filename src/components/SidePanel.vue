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
      <h3>底图设置</h3>
      <label class="form-label" for="style-url-input">样式 URL</label>
      <input
        id="style-url-input"
        v-model="styleUrl"
        class="text-input"
        type="url"
        placeholder="MapLibre 样式 URL"
        @change="updateStyleUrl"
      />
      <button type="button" class="button button--ghost" @click="clearStyleUrl">使用默认样式</button>

      <h3>POI 类别</h3>
      <div class="checkbox-grid">
        <label v-for="category in allCategories" :key="category" class="checkbox-item">
          <input
            :checked="filters.categories.includes(category)"
            type="checkbox"
            :value="category"
            @change="toggleCategory(category)"
          />
          <span>{{ translateCategory(category) }}</span>
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

      <button type="button" class="button button--primary" @click="requestIsochrone">
        生成等时圈
      </button>

      <h3>圈内找点</h3>
      <p class="helper-text">地图圈选后，列表将同步展示圈内设施。</p>

      <h3>智能选址权重</h3>
      <div class="slider-group">
        <label v-for="key in weightKeys" :key="key" class="slider-group__item">
          <span>{{ weightLabels[key] }} {{ weights[key] }}</span>
          <input
            type="range"
            min="0"
            max="10"
            :value="weights[key]"
            @input="updateWeight(key, $event)"
          />
        </label>
      </div>
      <button type="button" class="button button--secondary" @click="scoreSites">
        计算候选评分
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
        <button type="button" class="button button--ghost" @click="exportCandidateCsv">
          导出候选评分
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
import { computed, reactive, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../store/app';
import UploadModal from './UploadModal.vue';

interface WeightLabels {
  demand: string;
  accessibility: string;
  density: string;
  constraint: string;
}

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

const weightLabels: WeightLabels = {
  demand: '需求',
  accessibility: '可达性',
  density: '现有密度',
  constraint: '约束'
};

const emit = defineEmits<{
  (event: 'request-isochrone'): void;
  (event: 'export-poi-csv'): void;
  (event: 'export-candidate-csv'): void;
  (event: 'export-map-png'): void;
  (event: 'upload', payload: { type: 'geojson' | 'csv'; data: unknown }): void;
}>();

const activeTab = ref<(typeof tabs)[number]['value']>('layers');
const styleUrl = ref('');
const isUploadOpen = ref(false);
const selectedTimes = ref<number[]>([300, 600, 900]);
const travelMode = ref<'foot-walking' | 'cycling-regular' | 'driving-car'>('foot-walking');

const store = useAppStore();
const { filters, map, analysis, data } = storeToRefs(store);

const weights = reactive({
  demand: analysis.value.sitingWeights.demand,
  accessibility: analysis.value.sitingWeights.accessibility,
  density: analysis.value.sitingWeights.density,
  constraint: analysis.value.sitingWeights.constraint
});

const weightKeys = computed(() => Object.keys(weights) as Array<keyof typeof weights>);

const appName = computed(() => (import.meta.env.VITE_APP_NAME as string) ?? 'SmartReach');

const allCategories = computed(() => {
  if (!data.value.pois.length) {
    return filters.value.categories;
  }
  const fromData = Array.from(new Set(data.value.pois.map((poi) => poi.category)));
  return Array.from(new Set([...fromData, ...filters.value.categories]));
});

watch(
  () => map.value.styleUrl,
  (url) => {
    styleUrl.value = url ?? '';
  },
  { immediate: true }
);

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

function updateStyleUrl() {
  store.setMapStyleUrl(styleUrl.value.length ? styleUrl.value : undefined);
}

function clearStyleUrl() {
  styleUrl.value = '';
  updateStyleUrl();
}

function toggleCategory(category: string) {
  store.toggleCategory(category);
}

function translateCategory(category: string) {
  const mapping: Record<string, string> = {
    medical: '医疗',
    pharmacy: '药店',
    market: '市场',
    supermarket: '超市',
    convenience: '便利店',
    education: '教育',
    school: '学校',
    university: '大学',
    bus_stop: '公交站',
    metro: '地铁',
    charging: '充电',
    park: '公园',
    other: '其他'
  };
  return mapping[category] ?? category;
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

function updateWeight(key: keyof typeof weights, event: Event) {
  const target = event.target as HTMLInputElement;
  const value = Number(target.value);
  weights[key] = value;
}

watch(
  () => analysis.value.sitingWeights,
  (incoming) => {
    weights.demand = incoming.demand;
    weights.accessibility = incoming.accessibility;
    weights.density = incoming.density;
    weights.constraint = incoming.constraint;
  },
  { deep: true }
);

watch(
  weights,
  (updated) => {
    store.updateSitingWeights(updated);
  },
  { deep: true }
);

function scoreSites() {
  store.scoreCandidateSites();
}

async function handleUpload(payload: { type: 'geojson' | 'csv'; data: unknown }) {
  emit('upload', payload);
  isUploadOpen.value = false;
}

function requestIsochrone() {
  emit('request-isochrone');
}

function exportPoiCsv() {
  emit('export-poi-csv');
}

function exportCandidateCsv() {
  emit('export-candidate-csv');
}

function exportMapPng() {
  emit('export-map-png');
}
</script>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
  width: 320px;
  background: #f8f9fa;
  border-right: 1px solid #dee2e6;
  overflow-y: auto;
}

.side-panel__header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.side-panel__subtitle {
  margin: 0;
  color: #495057;
  font-size: 0.9rem;
}

.tab-list {
  display: flex;
  gap: 0.5rem;
}

.tab-list__item {
  flex: 1 1 0;
  border: none;
  padding: 0.6rem 0.75rem;
  background: #e9ecef;
  color: #495057;
  border-radius: 0.5rem;
  cursor: pointer;
}

.tab-list__item--active {
  background: #364fc7;
  color: #ffffff;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-label {
  font-weight: 600;
  color: #343a40;
}

.text-input,
.select-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid #ced4da;
}

.button {
  border: none;
  border-radius: 0.5rem;
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  font-weight: 600;
}

.button--primary {
  background: #4263eb;
  color: #ffffff;
}

.button--secondary {
  background: #ffd43b;
  color: #343a40;
}

.button--ghost {
  background: transparent;
  border: 1px solid #adb5bd;
  color: #343a40;
}

.checkbox-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.checkbox-item {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  font-size: 0.9rem;
  color: #343a40;
}

.helper-text {
  margin: 0;
  font-size: 0.85rem;
  color: #868e96;
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
  color: #495057;
}

.slider-group__item input {
  width: 100%;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.fieldset {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
</style>
