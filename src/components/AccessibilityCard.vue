<template>
  <section class="access-card" aria-label="可达性评价卡">
    <header class="access-card__header">
      <div>
        <h3 class="access-card__title">城市服务可达性</h3>
        <p class="access-card__subtitle">与南京平均对比（{{ profileLabel }}）</p>
      </div>
      <span v-if="accessibility.rating" class="access-card__badge">
        本地点：{{ accessibility.rating.level }}
      </span>
    </header>

    <p v-if="accessibility.loading" class="access-card__hint">正在评估可达性...</p>
    <p v-else-if="accessibility.error" class="access-card__hint access-card__hint--warn">
      {{ accessibility.error }}
    </p>
    <p v-else-if="accessibility.notice" class="access-card__hint access-card__hint--warn">
      {{ accessibility.notice }}
    </p>
    <p v-else-if="accessibility.active && accessibility.dirty" class="access-card__hint">
      参数变化，需重新评估
    </p>

    <div v-if="coreGroupIcons.length" class="access-card__icons">
      <span
        v-for="item in coreGroupIcons"
        :key="item.id"
        class="access-card__icon"
        :title="item.label"
      >
        {{ item.icon }}
      </span>
    </div>

    <div v-if="hasChart" class="access-card__chart">
      <div class="access-card__plot">
        <svg :viewBox="`0 0 ${chartSize.width} ${chartSize.height}`">
          <line
            v-for="(x, index) in gridXPositions"
            :key="`x-${index}`"
            :x1="x"
            :x2="x"
            :y1="chartSize.padding"
            :y2="chartSize.height - chartSize.padding"
            class="access-card__grid-line"
          />
          <line
            v-for="(y, index) in gridYPositions"
            :key="`y-${index}`"
            :x1="chartSize.padding"
            :x2="chartSize.width - chartSize.padding"
            :y1="y"
            :y2="y"
            class="access-card__grid-line access-card__grid-line--h"
          />
          <g v-if="yAxisTicks.length" class="access-card__y-text">
            <text
              v-for="(tick, index) in yAxisTicks"
              :key="tick.label"
              :x="chartSize.padding - 6"
              :y="gridYPositions[index] + 4"
              text-anchor="end"
              class="access-card__y-tick"
            >
              {{ tick.label }}
            </text>
          </g>
          <path
            v-if="hasCityLine"
            :d="cityLinePath"
            class="access-card__line access-card__line--city"
          />
          <path
            v-if="hasLocalLine"
            :d="localLinePath"
            class="access-card__line access-card__line--local"
          />
        </svg>
        <div
          v-if="thresholds.length"
          class="access-card__x-axis"
          :style="{ '--axis-count': thresholds.length }"
        >
          <span
            v-for="value in thresholds"
            :key="value"
            class="access-card__x-label"
            :class="{ 'access-card__x-label--highlight': value === 15 }"
          >
            {{ value }} 分
          </span>
        </div>
      </div>
      <div class="access-card__legend">
        <span v-if="hasLocalLine" class="legend-item">
          <svg class="legend-swatch" viewBox="0 0 36 6" aria-hidden="true">
            <line x1="0" y1="3" x2="36" y2="3" class="legend-line legend-line--local" />
          </svg>
          本地点
        </span>
        <span v-if="hasCityLine" class="legend-item">
          <svg class="legend-swatch" viewBox="0 0 36 6" aria-hidden="true">
            <line x1="0" y1="3" x2="36" y2="3" class="legend-line legend-line--city" />
          </svg>
          南京平均
        </span>
        <span class="access-card__axis-label">指数</span>
      </div>
      <div v-if="hasLocalLine || hasCityLine" class="access-card__scores">
        <span v-if="hasLocalLine" class="score-item">
          本地点：<span class="score-value">{{ localScoreText }}</span>
        </span>
        <span v-if="hasCityLine" class="score-item">
          南京平均：<span class="score-value">{{ cityScoreText }}</span>
        </span>
      </div>
    </div>

    <div v-if="countsPreview.length" class="access-card__groups">
      <span v-for="item in countsPreview" :key="item.id" class="access-card__group">
        {{ item.label }}：{{ item.count }}
      </span>
    </div>

    <p v-if="accessibility.rating" class="access-card__summary">
      本地点的城市服务可达性：<strong>{{ accessibility.rating.level }}</strong>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../store/app';
import { GROUP_LABELS } from '../utils/poiGroups';

const store = useAppStore();
const { accessibility } = storeToRefs(store);

const profileLabel = computed(() => {
  const profile = accessibility.value.profile;
  if (profile === 'driving-car') return '驾车';
  if (profile === 'cycling-regular') return '骑行';
  return '步行';
});

const chartSize = {
  width: 280,
  height: 170,
  padding: 26
};

const thresholds = computed(() => accessibility.value.thresholdsMin ?? []);
const gridXPositions = computed(() => {
  const { width, padding } = chartSize;
  const spanX = width - padding * 2;
  const count = Math.max(thresholds.value.length, 2);
  return Array.from({ length: count }, (_, index) =>
    padding + (spanX * index) / (count - 1)
  );
});

const hasLocalLine = computed(
  () =>
    accessibility.value.active &&
    Array.isArray(accessibility.value.index) &&
    accessibility.value.index.length > 1
);
const hasCityLine = computed(
  () =>
    accessibility.value.active &&
    accessibility.value.baselineProfileMatch &&
    Array.isArray(accessibility.value.cityIndex) &&
    accessibility.value.cityIndex.length > 1
);
const hasChart = computed(() => hasLocalLine.value || hasCityLine.value);

const chartRange = computed(() => {
  const values = [
    ...(hasLocalLine.value ? accessibility.value.index ?? [] : []),
    ...(hasCityLine.value ? accessibility.value.cityIndex ?? [] : [])
  ].filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min) * 0.2 || 0.2;
  return { min: Math.max(0, min - padding), max: max + padding };
});

const yAxisTicks = computed(() => {
  const { min, max } = chartRange.value;
  const steps = 4;
  const span = max - min || 1;
  return Array.from({ length: steps }, (_, idx) => {
    const value = max - (span * idx) / (steps - 1);
    return {
      value,
      label: value.toFixed(2)
    };
  });
});

const gridYPositions = computed(() => {
  const { height, padding } = chartSize;
  const spanY = height - padding * 2;
  const count = Math.max(yAxisTicks.value.length, 2);
  return Array.from({ length: count }, (_, index) =>
    padding + (spanY * index) / (count - 1)
  );
});

const buildPoints = (values: number[]) => {
  const { width, height, padding } = chartSize;
  const count = Math.max(values.length, 2);
  const spanX = width - padding * 2;
  const spanY = height - padding * 2;
  if (values.length <= 1) return [];
  const { min, max } = chartRange.value;
  const denom = max - min || 1;
  return values.map((value, index) => {
    const ratioX = index / (count - 1);
    const ratioY = (value - min) / denom;
    const x = padding + spanX * ratioX;
    const y = padding + spanY * (1 - ratioY);
    return { x, y };
  });
};

const buildSmoothPath = (points: Array<{ x: number; y: number }>) => {
  if (points.length < 2) return '';
  const tension = 0.6;
  const path = [`M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 6;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 6;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 6;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 6;
    path.push(
      `C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(
        2
      )} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
    );
  }
  return path.join(' ');
};

const localLinePath = computed(() =>
  accessibility.value.index ? buildSmoothPath(buildPoints(accessibility.value.index)) : ''
);
const cityLinePath = computed(() =>
  accessibility.value.cityIndex
    ? buildSmoothPath(buildPoints(accessibility.value.cityIndex))
    : ''
);

const computeCompositeScore = (values?: number[]) => {
  if (!values?.length) return null;
  const times = thresholds.value;
  const length = Math.min(values.length, times.length);
  if (length === 1) {
    return Number(values[0].toFixed(2));
  }
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < length - 1; i += 1) {
    const t0 = times[i] ?? 0;
    const t1 = times[i + 1] ?? t0;
    const span = Math.max(1, t1 - t0);
    const v0 = values[i] ?? 0;
    const v1 = values[i + 1] ?? v0;
    weighted += ((v0 + v1) / 2) * span;
    weightSum += span;
  }
  const score = weightSum ? weighted / weightSum : values[0] ?? 0;
  return Number(score.toFixed(2));
};

const localScoreText = computed(() => {
  const score = computeCompositeScore(accessibility.value.index);
  return score === null ? '—' : score.toFixed(2);
});
const cityScoreText = computed(() => {
  const score = computeCompositeScore(accessibility.value.cityIndex);
  return score === null ? '—' : score.toFixed(2);
});

const coreGroupIcons = computed(() => {
  const iconMap: Record<string, string> = {
    shopping: '购',
    transport: '交',
    medical: '医',
    education_culture: '教',
    entertainment_sports: '文',
    public_facility: '公'
  };
  return accessibility.value.coreGroups.map((groupId) => ({
    id: groupId,
    icon: iconMap[groupId] ?? groupId.slice(0, 1),
    label: GROUP_LABELS[groupId] ?? groupId
  }));
});

const countsPreview = computed(() => {
  const counts = accessibility.value.counts;
  const thresholds = accessibility.value.thresholdsMin;
  if (!counts || !thresholds?.length) {
    return [];
  }
  const idx = thresholds.indexOf(15);
  const index = idx >= 0 ? idx : 0;
  return accessibility.value.coreGroups.map((groupId) => ({
    id: groupId,
    label: GROUP_LABELS[groupId] ?? groupId,
    count: counts[groupId]?.[index] ?? 0
  }));
});
</script>

<style scoped>
.access-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid var(--border-soft);
  --access-line-local: #8b5cf6;
  --access-line-city: #9ca3af;
  --access-line-width: 2.5;
  --access-line-dash: 6 6;
}

.access-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.access-card__title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-1);
}

.access-card__subtitle {
  margin: 0.2rem 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.access-card__badge {
  background: rgba(var(--accent-rgb), 0.18);
  color: var(--text-primary);
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  border: 1px solid rgba(var(--accent-rgb), 0.4);
}

.access-card__hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.access-card__hint--warn {
  color: var(--warning-500);
}

.access-card__chart {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}

.access-card__plot {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.access-card__plot svg {
  width: 100%;
  height: 170px;
  display: block;
}

.access-card__y-text {
  fill: var(--text-muted);
  font-size: 9px;
}

.access-card__y-tick {
  dominant-baseline: middle;
}

.access-card__x-axis {
  display: grid;
  grid-template-columns: repeat(var(--axis-count), 1fr);
  gap: 0.1rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 0 0.25rem;
}

.access-card__x-label {
  text-align: center;
}

.access-card__x-label--highlight {
  color: var(--text-primary);
  font-weight: 700;
}

.access-card__icons {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.access-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid var(--border-soft);
  font-weight: 700;
}

.access-card__line {
  fill: none;
  stroke-width: var(--access-line-width);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.access-card__line--local {
  stroke: var(--access-line-local);
}

.access-card__line--city {
  stroke: var(--access-line-city);
  stroke-dasharray: var(--access-line-dash);
}

.access-card__legend {
  display: flex;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.access-card__scores {
  display: flex;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.access-card__axis-label {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.access-card__grid-line {
  stroke: rgba(148, 163, 184, 0.15);
  stroke-dasharray: 4 6;
}

.access-card__grid-line--h {
  stroke-dasharray: 2 6;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.score-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.legend-swatch {
  width: 36px;
  height: 6px;
}

.legend-line {
  stroke-linecap: round;
}

.legend-line--local {
  stroke: var(--access-line-local);
  stroke-width: var(--access-line-width);
}

.legend-line--city {
  stroke: var(--access-line-city);
  stroke-width: var(--access-line-width);
  stroke-dasharray: var(--access-line-dash);
}

.score-value {
  color: var(--text-primary);
  font-weight: 600;
}

.access-card__groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.8rem;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.access-card__group {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid var(--border-soft);
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
}

.access-card__summary {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}
</style>
