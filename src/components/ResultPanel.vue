<template>
  <aside class="result-panel" aria-label="结果面板">
    <section class="result-section">
      <header class="result-section__header">
        <h3>等时圈统计</h3>
        <span v-if="analysis.isochrone" class="badge">已生成</span>
        <span v-else class="badge badge--muted">未生成</span>
      </header>
      <div class="stat-tabs">
        <button
          v-for="item in isoGroupStatsSorted"
          :key="item.id"
          type="button"
          class="stat-tab"
          :class="{ 'stat-tab--active': item.id === ui.activeIsoGroupId }"
          :style="{ '--chip-color': item.color }"
          @click="setActiveIsoGroup(item.id)"
        >
          <span class="stat-tab__label">{{ item.label }}</span>
          <span class="stat-tab__value">{{ item.count }}</span>
        </button>
      </div>
    </section>

    <section class="result-section">
      <header class="result-section__header">
        <h3 v-if="activeGroupStat">
          圈内 POI · {{ activeGroupStat.label }}（{{ activeGroupStat.count }} 条）
        </h3>
        <h3 v-else>圈内 POI</h3>
        <span v-if="!activeGroupStat" class="result-section__meta">
          {{ `${activeIsoPois.length} 条` }}
        </span>
      </header>
      <p v-if="!analysis.isochrone" class="helper-text">请先生成等时圈查看结果。</p>
      <p v-else-if="!activeGroupStat" class="helper-text">当前筛选无结果。</p>
      <p v-else-if="!activeIsoPois.length" class="helper-text">该分类圈内暂无 POI。</p>
      <template v-else>
        <ul class="poi-list" aria-label="圈内 POI 列表">
          <li v-for="poi in activeIsoPoisPaged" :key="poi.id" class="poi-list__item">
            <div class="poi-list__info">
              <strong>{{ poi.name }}</strong>
              <span class="poi-list__meta">{{ formatTypeGroup(poi.type_group) }}</span>
            </div>
            <button type="button" class="button button--link" @click="navigateToPoi(poi)">
              路径
            </button>
          </li>
        </ul>
        <button
          v-if="canLoadMore"
          type="button"
          class="button button--ghost"
          @click="loadMorePois"
        >
          查看更多
        </button>
      </template>
    </section>

    <section class="result-section">
      <header class="result-section__header">
        <h3>路线规划</h3>
        <button
          type="button"
          class="button button--ghost"
          :disabled="!route.active"
          @click="clearRoute"
        >
          清除路线
        </button>
      </header>
      <p v-if="!route.active" class="helper-text">点击 POI 查看路线详情。</p>
      <p v-else-if="route.loading" class="helper-text">正在规划路线...</p>
      <template v-else>
        <p v-if="route.summary" class="route-summary">
          距离：{{ formatDistance(route.summary.distance) }}，
          用时：{{ formatDuration(route.summary.duration) }}
        </p>
        <p v-if="route.isFallback" class="helper-text helper-text--warn">
          当前为直线近似（ORS 不可用）
        </p>
        <p v-else-if="route.error" class="helper-text helper-text--warn">
          {{ route.error }}
        </p>
        <div v-if="route.steps?.length" class="route-steps">
          <h4>路线步骤</h4>
          <ol class="route-steps__list">
            <li v-for="(step, index) in visibleSteps" :key="index">
              {{ step.instruction }}（{{ formatDistance(step.distance) }} / {{ formatDuration(step.duration) }}）
            </li>
          </ol>
          <button
            v-if="route.steps.length > stepsPreviewCount"
            type="button"
            class="button button--ghost"
            @click="stepsExpanded = !stepsExpanded"
          >
            {{ stepsExpanded ? '收起步骤' : '展开全部步骤' }}
          </button>
        </div>
      </template>
    </section>

    <section class="result-section">
      <header class="result-section__header">
        <h3>候选点 Top 3</h3>
        <span class="result-section__meta">{{ topCandidates.length }} 项</span>
      </header>
      <ul class="candidate-list" aria-label="候选评分列表">
        <li v-for="candidate in topCandidates" :key="candidate.id" class="candidate-card">
          <div class="candidate-card__header">
            <strong>{{ candidate.name }}</strong>
            <span class="candidate-card__score">{{ candidate.score ?? '?' }}</span>
          </div>
          <div class="candidate-card__body">
            <span class="candidate-card__category">{{ formatTypeGroup(candidate.type_group) }}</span>
            <div class="candidate-card__chart-placeholder" role="img" aria-label="雷达图占位">
              雷达图占位
            </div>
          </div>
          <footer class="candidate-card__footer">
            <button type="button" class="button button--ghost" @click="navigateToPoi(candidate)">
              查看
            </button>
          </footer>
        </li>
      </ul>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { POI } from '../types/poi';
import { useAppStore } from '../store/app';

const emit = defineEmits<{
  (event: 'navigate', poi: POI): void;
}>();

const store = useAppStore();
const { analysis, topCandidates, route, ui, isoGroupStatsSorted, activeIsoPois, activeIsoPoisPaged } =
  storeToRefs(store);

const stepsExpanded = ref(false);
const stepsPreviewCount = 10;
const canLoadMore = computed(
  () => activeIsoPoisPaged.value.length < activeIsoPois.value.length
);
const visibleSteps = computed(() => {
  if (!route.value.steps?.length) {
    return [];
  }
  return stepsExpanded.value
    ? route.value.steps
    : route.value.steps.slice(0, stepsPreviewCount);
});

watch(
  () => route.value.active,
  (active) => {
    if (!active) {
      stepsExpanded.value = false;
    }
  }
);

const activeGroupStat = computed(() =>
  isoGroupStatsSorted.value.find((item) => item.id === ui.value.activeIsoGroupId)
);

function formatTypeGroup(typeGroup: string) {
  const mapping: Record<string, string> = {
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
    address: '地名地址',
    other: '其他'
  };
  return mapping[typeGroup] ?? typeGroup;
}

function loadMorePois() {
  store.loadMoreIsoPois();
}

function setActiveIsoGroup(id: string) {
  store.setActiveIsoGroup(id);
}

function navigateToPoi(poi: POI) {
  emit('navigate', poi);
}

function clearRoute() {
  store.clearRoute();
}

function formatDistance(distance: number) {
  if (!Number.isFinite(distance)) {
    return '-';
  }
  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distance)} m`;
}

function formatDuration(duration: number) {
  if (!Number.isFinite(duration)) {
    return '-';
  }
  if (duration >= 3600) {
    return `${(duration / 60).toFixed(0)} 分钟`;
  }
  if (duration >= 60) {
    return `${Math.round(duration / 60)} 分钟`;
  }
  return `${Math.round(duration)} 秒`;
}
</script>

<style scoped>
.result-panel {
  display: flex;
  flex-direction: column;
  width: 320px;
  padding: 1.5rem;
  gap: 1.5rem;
  border-left: 1px solid #dee2e6;
  background: #ffffff;
  overflow-y: auto;
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.result-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.result-section__meta {
  color: #868e96;
  font-size: 0.85rem;
}

.helper-text {
  margin: 0;
  font-size: 0.85rem;
  color: #868e96;
}

.route-summary {
  margin: 0;
  font-size: 0.9rem;
  color: #343a40;
}

.route-steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.route-steps__list {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.35rem;
  color: #495057;
  font-size: 0.85rem;
}

.stat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.stat-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid #e9ecef;
  background: #f1f3f5;
  color: #495057;
  font-size: 0.85rem;
  cursor: pointer;
  font-family: inherit;
}

.stat-tab__label {
  font-weight: 600;
}

.stat-tab__value {
  font-variant-numeric: tabular-nums;
  color: var(--chip-color, #364fc7);
}

.stat-tab--active {
  border-color: var(--chip-color, #364fc7);
  background: #ffffff;
  color: #212529;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.04);
}

.poi-list,
.candidate-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.75rem;
}

.poi-list__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8f9fa;
  padding: 0.75rem;
  border-radius: 0.5rem;
}

.poi-list__info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.poi-list__meta {
  color: #868e96;
  font-size: 0.85rem;
}

.candidate-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid #e9ecef;
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: #f8f9fa;
}

.candidate-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.candidate-card__score {
  font-weight: 700;
  color: #f08c00;
}

.candidate-card__category {
  font-size: 0.85rem;
  color: #868e96;
}

.candidate-card__chart-placeholder {
  margin-top: 0.5rem;
  border: 1px dashed #ced4da;
  border-radius: 0.75rem;
  padding: 1.5rem;
  text-align: center;
  font-size: 0.85rem;
  color: #adb5bd;
}

.candidate-card__footer {
  display: flex;
  justify-content: flex-end;
}

.button {
  border: none;
  background: none;
  cursor: pointer;
  font-weight: 600;
  color: #4263eb;
}

.button--link {
  padding: 0;
}

.button--ghost {
  border: 1px solid #4263eb;
  border-radius: 0.5rem;
  padding: 0.4rem 0.8rem;
}

.badge {
  border-radius: 999px;
  background: #51cf66;
  color: #ffffff;
  padding: 0.2rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge--muted {
  background: #adb5bd;
}
</style>
