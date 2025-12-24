<template>
  <aside class="result-panel" aria-label="结果面板">
    <section class="result-section">
      <header class="result-section__header">
        <h3>等时圈统计</h3>
        <span v-if="analysis.isochrone" class="badge">已生成</span>
        <span v-else class="badge badge--muted">未生成</span>
      </header>
      <ul class="stat-list">
        <li v-for="item in typeStats" :key="item.type_group" class="stat-list__item">
          <span class="stat-list__label">{{ item.label }}</span>
          <span class="stat-list__value">{{ item.count }}</span>
        </li>
      </ul>
    </section>

    <section class="result-section">
      <header class="result-section__header">
        <h3>圈内 POI</h3>
        <span class="result-section__meta">{{ visiblePoisInIsochrone.length }} 条</span>
      </header>
      <p v-if="!analysis.isochrone" class="helper-text">请先生成等时圈查看结果。</p>
      <p v-else-if="!visiblePoisInIsochrone.length" class="helper-text">
        当前筛选无结果。
      </p>
      <template v-else>
        <ul class="poi-list" aria-label="圈内 POI 列表">
          <li v-for="poi in pagedPois" :key="poi.id" class="poi-list__item">
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
const { analysis, topCandidates, visiblePoisInIsochrone } = storeToRefs(store);

const page = ref(1);
const pageSize = 200;
const pagedPois = computed(() =>
  visiblePoisInIsochrone.value.slice(0, page.value * pageSize)
);
const canLoadMore = computed(
  () => pagedPois.value.length < visiblePoisInIsochrone.value.length
);

watch(
  visiblePoisInIsochrone,
  () => {
    page.value = 1;
  },
  { deep: true }
);

const typeStats = computed(() => {
  const stats = new Map<string, number>();
  visiblePoisInIsochrone.value.forEach((poi) => {
    stats.set(poi.type_group, (stats.get(poi.type_group) ?? 0) + 1);
  });

  return Array.from(stats.entries()).map(([type_group, count]) => ({
    type_group,
    label: formatTypeGroup(type_group),
    count
  }));
});

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
  page.value += 1;
}

function navigateToPoi(poi: POI) {
  emit('navigate', poi);
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

.stat-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.stat-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f1f3f5;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
}

.stat-list__label {
  font-size: 0.9rem;
  color: #495057;
}

.stat-list__value {
  font-weight: 600;
  color: #364fc7;
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
