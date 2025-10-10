<template>
  <aside class="result-panel" aria-label="结果面板">
    <section class="result-section">
      <header class="result-section__header">
        <h3>等时圈统计</h3>
        <span v-if="analysis.isochrone" class="badge">已生成</span>
        <span v-else class="badge badge--muted">待生成</span>
      </header>
      <ul class="stat-list">
        <li v-for="item in categoryStats" :key="item.category" class="stat-list__item">
          <span class="stat-list__label">{{ item.label }}</span>
          <span class="stat-list__value">{{ item.count }}</span>
        </li>
      </ul>
    </section>

    <section class="result-section">
      <header class="result-section__header">
        <h3>圈内设施</h3>
        <span class="result-section__meta">{{ poisInIsochrone.length }} 项</span>
      </header>
      <ul class="poi-list" aria-label="圈内设施列表">
        <li v-for="poi in poisInIsochrone" :key="poi.id" class="poi-list__item">
          <div class="poi-list__info">
            <strong>{{ poi.name }}</strong>
            <span class="poi-list__meta">{{ translateCategory(poi.category) }}</span>
          </div>
          <button type="button" class="button button--link" @click="navigateToPoi(poi)">
            导航
          </button>
        </li>
      </ul>
    </section>

    <section class="result-section">
      <header class="result-section__header">
        <h3>智能选址 Top 3</h3>
        <span class="result-section__meta">{{ topCandidates.length }} 项</span>
      </header>
      <ul class="candidate-list" aria-label="候选评分列表">
        <li v-for="candidate in topCandidates" :key="candidate.id" class="candidate-card">
          <div class="candidate-card__header">
            <strong>{{ candidate.name }}</strong>
            <span class="candidate-card__score">{{ candidate.score ?? '—' }}</span>
          </div>
          <div class="candidate-card__body">
            <span class="candidate-card__category">{{ translateCategory(candidate.category) }}</span>
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
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import type { POI } from '../types/poi';
import { useAppStore } from '../store/app';

const emit = defineEmits<{
  (event: 'navigate', poi: POI): void;
}>();

const store = useAppStore();
const { data, analysis, topCandidates } = storeToRefs(store);

const poisInIsochrone = computed(() => data.value.poisInIsochrone);

const categoryStats = computed(() => {
  const stats = new Map<string, number>();
  poisInIsochrone.value.forEach((poi) => {
    stats.set(poi.category, (stats.get(poi.category) ?? 0) + 1);
  });

  return Array.from(stats.entries()).map(([category, count]) => ({
    category,
    label: translateCategory(category),
    count
  }));
});

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
    charging: '充电站',
    park: '公园',
    other: '其他'
  };
  return mapping[category] ?? category;
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
