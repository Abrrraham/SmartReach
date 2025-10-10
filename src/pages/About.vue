<template>
  <div class="page-about">
    <HeaderBar />
    <main class="page-about__content">
      <section class="about-section">
        <h2>数据来源</h2>
        <p>基础设施数据来自公开开放的 OpenStreetMap 社区贡献以及南京市公开数据平台。</p>
      </section>
      <section class="about-section">
        <h2>开源许可</h2>
        <p>
          本项目基于 Vue 3 与 MapLibre 构建，遵循 MIT 许可证。地图瓦片遵循各自提供方的开放许可（如 OpenStreetMap
          ODbL）。
        </p>
      </section>
      <section class="about-section">
        <h2>鸣谢</h2>
        <p>感谢 MapLibre、OpenRouteService、Turf.js 等开源社区提供的优秀工具。</p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import HeaderBar from '../components/HeaderBar.vue';
</script>

<style scoped>
.page-about {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8f9fa;
}

.page-about__content {
  flex: 1 1 auto;
  max-width: 820px;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.about-section {
  background: #ffffff;
  border-radius: 1rem;
  padding: 1.5rem 2rem;
  box-shadow: 0 10px 20px rgba(52, 58, 64, 0.08);
}

.about-section h2 {
  margin-top: 0;
}

.about-section p {
  margin-bottom: 0;
  color: #495057;
  line-height: 1.6;
}
</style>
