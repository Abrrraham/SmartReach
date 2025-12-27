<template>
  <aside class="result-panel card-glass" aria-label="结果面板">
    <div class="result-tabs" role="tablist" aria-label="结果切换">
      <button
        type="button"
        class="result-tab"
        role="tab"
        :aria-selected="ui.rightTab === 'iso'"
        :class="{ 'result-tab--active': ui.rightTab === 'iso' }"
        @click="setRightTab('iso')"
      >
        等时圈分析
      </button>
      <button
        type="button"
        class="result-tab"
        role="tab"
        :aria-selected="ui.rightTab === 'site'"
        :class="{ 'result-tab--active': ui.rightTab === 'site' }"
        @click="setRightTab('site')"
      >
        智能选址
      </button>
    </div>

    <section
      v-show="ui.rightTab === 'iso'"
      class="result-section"
      :class="{ 'result-section--active': ui.rightTab === 'iso' }"
      aria-label="路线规划"
    >
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
      <p v-if="!route.active && !route.loading" class="helper-text">点击 POI 查看路线详情。</p>
      <p v-else-if="route.loading" class="helper-text">正在规划路线...</p>
      <template v-else>
        <p v-if="route.summary" class="route-summary">
          距离：{{ formatDistance(route.summary.distance) }}；
          用时：{{ formatDuration(route.summary.duration) }}；
          方式：{{ formatProfile(route.profile) }}
        </p>
        <p v-else class="route-summary">方式：{{ formatProfile(route.profile) }}</p>
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
    <section
      v-show="ui.rightTab === 'site'"
      class="result-section"
      :class="{ 'result-section--active': ui.rightTab === 'site' }"
      aria-label="候选点 Top10"
    >
      <header class="result-section__header">
        <h3>候选点 Top10</h3>
        <span class="result-section__meta">{{ siteEngine.results.length }} 项</span>
      </header>
      <div class="result-actions">
        <button
          type="button"
          class="button button--ghost"
          :disabled="ui.bboxPickArmed"
          @click="reselectBbox"
        >
          重新框选
        </button>
        <button
          type="button"
          class="button button--ghost"
          :disabled="!siteEngine.bbox || siteEngine.running"
          @click="rerunSiteSelection"
        >
          重新计算
        </button>
        <button type="button" class="button button--ghost" @click="clearSiteSelection">
          清除选址结果
        </button>
        <button
          type="button"
          class="button button--ghost"
          :disabled="!siteEngine.results.length"
          @click="exportSiteResults"
        >
          导出候选评分（CSV）
        </button>
      </div>
      <p v-if="!siteEngine.bbox" class="helper-text">请先框选范围后开始选址。</p>
      <p v-else-if="siteEngine.running" class="helper-text">正在计算候选点...</p>
      <p v-else-if="!siteEngine.results.length" class="helper-text">
        暂无候选点，请点击“开始选址/重新计算”。
      </p>
      <ul v-else class="site-result-list" aria-label="候选点 Top10 列表">
        <li
          v-for="item in siteEngine.results"
          :key="item.rank"
          class="site-result-item"
          :class="{ 'site-result-item--active': item.rank === siteEngine.selectedRank }"
        >
          <div class="site-result-item__main" @click="selectSite(item.rank)">
            <span class="site-result-item__rank">{{ item.rank }}</span>
            <div class="site-result-item__body">
              <strong>{{ item.address ?? '解析中…' }}</strong>
              <span class="site-result-item__meta">
                {{ formatScore(item.total) }} 分· {{ formatLngLat(item.lng, item.lat) }}
              </span>
            </div>
            <button
              type="button"
              class="button button--ghost site-result-item__toggle"
              :aria-expanded="Boolean(siteEngine.expandedRanks[item.rank])"
              @click.stop="toggleSiteExplain(item.rank)"
            >
              {{ siteEngine.expandedRanks[item.rank] ? '收起解释' : '展开解释' }}
            </button>
          </div>
          <Transition name="collapse">
            <div v-if="siteEngine.expandedRanks[item.rank]" class="site-explain">
            <div class="site-explain__header">
              <strong>分项解释</strong>
              <span class="site-explain__score">总分 {{ formatScore(item.total) }}</span>
            </div>
            <div v-for="key in metricKeys" :key="key" class="metric-row">
              <span class="metric-label">{{ metricLabels[key] }}</span>
              <div class="metric-bar">
                <span
                  class="metric-bar__fill"
                  :style="{ '--metric-scale': metricValue(item, key) / 100 }"
                />
              </div>
              <span class="metric-value">{{ metricValue(item, key).toFixed(0) }}%</span>
            </div>
            </div>
          </Transition>
        </li>
      </ul>
    </section>
    <section
      v-show="ui.rightTab === 'iso'"
      class="result-section"
      :class="{ 'result-section--active': ui.rightTab === 'iso' }"
    >
      <header class="result-section__header">
        <h3>等时圈统计</h3>
        <span v-if="analysis.isochrone" class="badge">已生成</span>
        <span v-else class="badge badge--muted">未生成</span>
      </header>
      <div v-if="isoGroupStatsSorted.length" class="stat-tabs">
        <button
          v-for="item in isoGroupStatsSorted"
          :key="item.id"
          type="button"
          class="stat-tab"
          :class="{ 'stat-tab--active': item.id === ui.activeIsoGroupId }"
          :style="{ '--chip-color': item.color }"
          @click="setActiveIsoGroup(item.id)"
        >
          <span class="stat-tab__dot" :style="{ backgroundColor: item.color }" />
          <span class="stat-tab__label">{{ item.label }}</span>
          <span class="stat-tab__value">{{ item.count }} 条</span>
        </button>
      </div>
      <p v-else-if="analysis.isochrone" class="helper-text">
        未选择任何分类，暂无统计结果。
      </p>
      <p v-else class="helper-text">请先生成等时圈查看统计。</p>
    </section>

    <section
      v-show="ui.rightTab === 'iso'"
      class="result-section"
      :class="{ 'result-section--active': ui.rightTab === 'iso' }"
    >
      <header class="result-section__header">
        <h3>
          圈内 POI · {{ activeGroupStat?.label ?? '未选择分类' }}（{{ activeGroupStat?.count ?? 0 }} 条）
        </h3>
      </header>
      <p v-if="!analysis.isochrone" class="helper-text">请先生成等时圈查看结果。</p>
      <p v-else-if="!isoGroupStatsSorted.length" class="helper-text">未选择任何分类，暂无结果。</p>
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
const { analysis, route, ui, isoGroupStatsSorted, activeIsoPois, activeIsoPoisPaged, siteEngine } =
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

const metricKeys = ['demand', 'access', 'competition', 'synergy', 'center'] as const;
const metricLabels: Record<(typeof metricKeys)[number], string> = {
  demand: '需求',
  access: '可达性',
  competition: '竞争压力',
  synergy: '协同',
  center: '中心性'
};

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

function formatProfile(profile: string) {
  const mapping: Record<string, string> = {
    'foot-walking': '步行',
    'cycling-regular': '骑行',
    'driving-car': '驾车'
  };
  return mapping[profile] ?? profile;
}

function loadMorePois() {
  store.loadMoreIsoPois();
}

function setActiveIsoGroup(id: string) {
  store.setActiveIsoGroup(id);
}

function setRightTab(tab: 'iso' | 'site') {
  store.setRightTab(tab);
}

function navigateToPoi(poi: POI) {
  emit('navigate', poi);
}

function clearRoute() {
  store.clearRoute();
}

function selectSite(rank: number) {
  store.selectSiteResult(rank);
}

function toggleSiteExplain(rank: number) {
  store.toggleSiteExplain(rank);
}

function reselectBbox() {
  store.armBboxPick();
}

function rerunSiteSelection() {
  store.runSiteSelectionTopN();
}

function clearSiteSelection() {
  store.clearSiteSelection();
}

function exportSiteResults() {
  store.exportSiteResultsCsv();
}

function metricValue(
  site: { metrics: Record<string, number> },
  key: (typeof metricKeys)[number]
) {
  const value = Number(site.metrics?.[key] ?? 0);
  return Math.min(100, Math.max(0, value * 100));
}

function formatScore(total: number) {
  if (!Number.isFinite(total)) {
    return 0;
  }
  return Math.round(total * 100);
}

function formatLngLat(lng: number, lat: number) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return '-';
  }
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
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
  width: 330px;
  padding: 1.5rem;
  gap: 1.5rem;
  border-left: 1px solid var(--border-soft);
  background: var(--panel-bg);
  overflow-y: auto;
  box-shadow: -10px 0 28px rgba(2, 6, 23, 0.25);
  backdrop-filter: blur(16px);
  position: relative;
}

.result-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: -1px;
  width: 18px;
  height: 100%;
  background: linear-gradient(270deg, rgba(10, 16, 30, 0.85), rgba(10, 16, 30, 0));
  pointer-events: none;
}

.result-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.result-tab {
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.65);
  padding: 0.55rem 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  position: relative;
  transition:
    color var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out),
    transform var(--t-fast) var(--ease-out);
}

.result-tab::after {
  content: '';
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 6px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--brand-500), var(--accent-500));
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 200ms var(--ease-out);
}

.result-tab--active {
  border-color: rgba(var(--brand-rgb), 0.35);
  background: rgba(var(--brand-rgb), 0.16);
  color: var(--text-primary);
}

.result-tab--active::after {
  transform: scaleX(1);
}

.result-tab:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.result-section--active {
  animation: tab-fade var(--t-fast) var(--ease-out);
}

.result-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.result-section h3,
.result-section h4 {
  margin: 0;
  color: var(--text-primary);
}

.result-section__meta {
  color: var(--text-muted);
  font-size: 0.85rem;
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

.route-summary {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
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
  color: var(--text-muted);
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
  gap: 0.45rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border-soft);
  background: rgba(15, 23, 42, 0.55);
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  font-family: inherit;
  transition:
    transform var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.stat-tab__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--chip-color, #364fc7);
  box-shadow: 0 0 0 2px rgba(2, 6, 23, 0.5);
}

.stat-tab__label {
  font-weight: 600;
}

.stat-tab__value {
  font-variant-numeric: tabular-nums;
  color: var(--chip-color, #364fc7);
}

.stat-tab--active {
  border-color: var(--chip-color, #38bdf8);
  background: rgba(15, 23, 42, 0.75);
  color: var(--text-primary);
  box-shadow: 0 0 0 1px rgba(var(--brand-rgb), 0.18);
}

.stat-tab:hover {
  transform: translateY(-1px);
}

.poi-list,
.site-result-list {
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
  background: rgba(15, 23, 42, 0.55);
  padding: 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  transition:
    transform var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out);
}

.poi-list__item:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--brand-rgb), 0.35);
  box-shadow: var(--shadow-soft);
}

.poi-list__info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.poi-list__meta {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.site-result-item {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background: linear-gradient(160deg, rgba(15, 23, 42, 0.7), rgba(15, 23, 42, 0.45));
  transition:
    transform var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.site-result-item:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--brand-rgb), 0.35);
  box-shadow: var(--shadow-soft);
  background: linear-gradient(160deg, rgba(15, 23, 42, 0.8), rgba(8, 15, 30, 0.55));
}

.site-result-item__main {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: 0.6rem;
  align-items: center;
  cursor: pointer;
}

.site-result-item--active {
  border-color: rgba(var(--brand-rgb), 0.55);
  background: linear-gradient(
    160deg,
    rgba(var(--brand-rgb), 0.18),
    rgba(var(--accent-rgb), 0.16)
  );
}

.site-result-item__rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(120deg, var(--brand-500), var(--accent-500));
  color: var(--text-on-accent);
  font-size: 0.85rem;
  font-weight: 700;
}

.site-result-item__body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.site-result-item__meta {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.site-result-item__toggle {
  padding: 0.3rem 0.6rem;
  font-size: 0.75rem;
  opacity: 0.5;
  transition: opacity var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
}

.site-result-item:hover .site-result-item__toggle,
.site-result-item:focus-within .site-result-item__toggle {
  opacity: 1;
  transform: translateX(-2px);
}

.site-explain {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-left: 1.6rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-md);
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid var(--border-soft);
  overflow: hidden;
}

.site-explain__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.site-explain__score {
  font-weight: 600;
  color: var(--brand-500);
}

.metric-row {
  display: grid;
  grid-template-columns: 70px 1fr 40px;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.metric-label {
  font-weight: 600;
}

.metric-bar {
  position: relative;
  height: 8px;
  background: rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  overflow: hidden;
}

.metric-bar__fill {
  position: absolute;
  inset: 0;
  width: 100%;
  transform: scaleX(var(--metric-scale, 0));
  transform-origin: left center;
  background: linear-gradient(90deg, rgba(var(--brand-rgb), 0.9), rgba(var(--accent-rgb), 0.85));
  transition: transform 400ms var(--ease-out);
}

.metric-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.button {
  border: 1px solid transparent;
  background: rgba(15, 23, 42, 0.4);
  cursor: pointer;
  font-weight: 600;
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 0.4rem 0.8rem;
  transition:
    transform var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.button--link {
  padding: 0;
  border: none;
  background: none;
  color: var(--brand-500);
}

.button--ghost {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.45);
}

.badge {
  border-radius: 999px;
  background: rgba(var(--success-rgb), 0.18);
  color: var(--success-100);
  padding: 0.2rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid rgba(var(--success-rgb), 0.4);
}

.badge--muted {
  background: rgba(148, 163, 184, 0.22);
  color: var(--text-muted);
  border-color: rgba(148, 163, 184, 0.4);
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(var(--brand-rgb), 0.35);
  box-shadow: var(--shadow-soft);
  color: var(--text-primary);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.collapse-enter-active,
.collapse-leave-active {
  transition: max-height 280ms var(--ease-out), opacity 280ms var(--ease-out);
}

.collapse-enter-from,
.collapse-leave-to {
  max-height: 0;
  opacity: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  max-height: 300px;
  opacity: 1;
}

.collapse-enter-from .metric-bar__fill {
  transform: scaleX(0);
}

.collapse-enter-to .metric-bar__fill {
  transform: scaleX(var(--metric-scale, 0));
}
</style>
