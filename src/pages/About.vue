<template>
  <div class="page-shell page-bg page-about">
    <HeaderBar />
    <main class="page-main">
      <div class="page-container">
        <section class="about-hero card-glass">
          <h1>关于 SmartReach</h1>
          <p>
            SmartReach 是面向城市设施可达性与选址评估的分析工作台，聚合 POI 数据、
            MapLibre 地图渲染与 OpenRouteService 路径/等时圈服务，支持可视化决策与对比分析。
          </p>
        </section>

        <section class="about-grid">
          <article class="about-card card-glass">
            <div class="about-card__header">
              <span class="about-card__icon about-card__icon--data" aria-hidden="true" />
              <h2>数据来源</h2>
            </div>
            <p>
              底图：高德地图（AMap raster）。地理编码：高德地理编码（AMap Web Service）。
              POI 与基础设施数据来自公开数据与用户上传数据。
            </p>
          </article>
          <article class="about-card card-glass">
            <div class="about-card__header">
              <span class="about-card__icon about-card__icon--feature" aria-hidden="true" />
              <h2>功能概览</h2>
            </div>
            <p>
              支持 POI 分类与聚合、等时圈分析、圈内设施统计、路径规划与智能选址 Top10，
              帮助快速识别服务覆盖与布局差异。
            </p>
          </article>
          <article class="about-card card-glass">
            <div class="about-card__header">
              <span class="about-card__icon about-card__icon--license" aria-hidden="true" />
              <h2>开源许可与致谢</h2>
            </div>
            <p>
              项目基于 Vue 3、Pinia 与 MapLibre 构建，遵循 MIT 许可证。
              感谢 MapLibre、OpenRouteService、Turf.js 等开源社区提供的优秀工具。
            </p>
          </article>
          <article class="about-card card-glass">
            <div class="about-card__header">
              <span class="about-card__icon about-card__icon--note" aria-hidden="true" />
              <h2>免责声明</h2>
            </div>
            <p>
              本项目用于教学与研究演示，结果仅供参考，不构成正式规划建议。
              部分服务需依赖外部 API，可用性取决于第三方服务状态。
            </p>
          </article>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import HeaderBar from '../components/HeaderBar.vue';
</script>

<style scoped>
.about-hero {
  padding: 2.3rem 2.6rem;
  border: 1px solid var(--border-soft);
}

.about-hero h1 {
  margin: 0 0 0.8rem;
  font-size: clamp(2rem, 2.4vw, 2.6rem);
}

.about-hero p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.7;
}

.about-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1.2rem;
}

.about-card {
  padding: 1.4rem 1.5rem;
  border: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.about-card__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.about-card h2 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--text-primary);
}

.about-card__icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid var(--border-soft);
  background: rgba(var(--brand-rgb), 0.18);
  box-shadow: inset 0 0 10px rgba(var(--brand-rgb), 0.25);
  position: relative;
}

.about-card__icon::after {
  content: '';
  position: absolute;
  inset: 9px;
  border-radius: 8px;
  background: rgba(var(--brand-rgb), 0.6);
}

.about-card__icon--feature {
  background: rgba(var(--accent-rgb), 0.18);
  box-shadow: inset 0 0 10px rgba(var(--accent-rgb), 0.25);
}

.about-card__icon--feature::after {
  background: rgba(var(--accent-rgb), 0.6);
}

.about-card__icon--license {
  background: rgba(var(--info-rgb), 0.18);
  box-shadow: inset 0 0 10px rgba(var(--info-rgb), 0.25);
}

.about-card__icon--license::after {
  background: rgba(var(--info-rgb), 0.6);
}

.about-card__icon--note {
  background: rgba(var(--warning-rgb), 0.16);
  box-shadow: inset 0 0 10px rgba(var(--warning-rgb), 0.22);
}

.about-card__icon--note::after {
  background: rgba(var(--warning-rgb), 0.6);
}

.about-card p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
