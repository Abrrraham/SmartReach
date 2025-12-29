<template>
  <div class="page-shell page-bg page-home">
    <HeaderBar />
    <main class="page-main">
      <div class="page-container">
        <section class="hero card-glass">
          <span class="pill hero__pill">城市可达性工作台</span>
          <h1 class="hero__title">{{ appName }}</h1>
          <p class="hero__subtitle">{{ defaultCity }} · 城市可达性工作台</p>
          <p class="hero__desc">
            聚焦城市设施可达性与选址评估，通过 POI 分类聚合、等时圈与路径分析，辅助规划决策与公平服务。
          </p>
          <div class="hero__actions">
            <RouterLink class="btn btn-primary" to="/workbench">进入工作台</RouterLink>
            <RouterLink class="btn btn-secondary" to="/about">查看关于</RouterLink>
          </div>
        </section>

        <section class="feature-grid">
          <article v-for="feature in features" :key="feature.title" class="feature-card card-glass">
            <span class="tag">{{ feature.tag }}</span>
            <h2 class="feature-card__title">{{ feature.title }}</h2>
            <p class="feature-card__text">{{ feature.description }}</p>
          </article>
        </section>

        <p class="page-footnote muted">
          数据来源：高德地图（AMap）与公开 POI 数据。技术栈：Vue 3 / Pinia / MapLibre / OpenRouteService。
        </p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { APP_NAME, DEFAULT_CITY } from '../config/env';
import HeaderBar from '../components/HeaderBar.vue';

const appName = computed(() => APP_NAME);
const defaultCity = computed(() => DEFAULT_CITY);

const features = [
  {
    title: 'POI 分类与聚合',
    description: '快速筛选多类型设施，支持视区内聚合展示与分布洞察。',
    tag: '分类聚合'
  },
  {
    title: '等时圈分析',
    description: '以选点为中心生成多档等时圈，直观评估通达范围。',
    tag: '可达评估'
  },
  {
    title: '圈内设施统计与路径',
    description: '统计圈内 POI 并一键规划路径，辅助服务覆盖与效率判断。',
    tag: '统计与路线'
  },
  {
    title: '智能选址 Top10',
    description: '根据目标业态与范围约束输出候选 Top10，支持对比解释。',
    tag: '选址推荐'
  }
];
</script>

<style scoped>
.hero {
  padding: 2.6rem 2.8rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border: 1px solid var(--border-soft);
  background:
    linear-gradient(140deg, rgba(var(--brand-rgb), 0.12), rgba(var(--accent-rgb), 0.16)),
    rgba(12, 20, 35, 0.85);
}

.hero__pill {
  align-self: flex-start;
}

.hero__title {
  margin: 0;
  font-size: clamp(2.3rem, 2.6vw, 3rem);
  letter-spacing: 0.4px;
}

.hero__subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 600;
}

.hero__desc {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.7;
  max-width: 720px;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 1.2rem;
}

.feature-card {
  padding: 1.35rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  border: 1px solid var(--border-soft);
  transition:
    transform var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out);
}

.feature-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-strong);
}

.feature-card__title {
  margin: 0;
  font-size: 1.1rem;
  color: var(--text-primary);
}

.feature-card__text {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}

.page-footnote {
  margin: 0;
  text-align: center;
  font-size: 0.85rem;
}

@media (max-width: 720px) {
  .hero {
    padding: 2rem 1.6rem;
  }

  .hero__actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
