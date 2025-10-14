<template>
  <div class="page page--center">
    <main class="hero">
      <h1>{{ appName }}</h1>
      <p>
        打开城市可达性智能平台，探索南京的医疗、教育、生活圈可达性，助力科学规划与公平服务。
      </p>
      <RouterLink class="hero__action" to="/workbench">进入工作台</RouterLink>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const appName = computed(() => (import.meta.env.VITE_APP_NAME as string) ?? 'SmartReach');
</script>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #edf2ff, #d0ebff);
}

.hero {
  text-align: center;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background: rgba(255, 255, 255, 0.85);
  padding: 2.5rem 3rem;
  border-radius: 1.25rem;
  box-shadow: 0 20px 40px rgba(76, 110, 245, 0.25);
}

.hero h1 {
  margin: 0;
  font-size: 2rem;
}

.hero p {
  margin: 0;
  color: #495057;
  line-height: 1.6;
}

.hero__action {
  align-self: center;
  padding: 0.75rem 1.5rem;
  background: #4263eb;
  color: #ffffff;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 600;
}
</style>
