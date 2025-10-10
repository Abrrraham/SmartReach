<template>
  <header class="header-bar" aria-label="应用导航栏">
    <div class="header-bar__branding">
      <h1 class="header-bar__title">{{ appName }}</h1>
      <p class="header-bar__subtitle">{{ defaultCity }}</p>
    </div>
    <nav class="header-bar__nav" aria-label="主导航">
      <RouterLink to="/" class="header-bar__link">首页</RouterLink>
      <RouterLink to="/workbench" class="header-bar__link">工作台</RouterLink>
      <RouterLink to="/about" class="header-bar__link">关于</RouterLink>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const appName = computed(() => (import.meta.env.VITE_APP_NAME as string) ?? 'CityAccess+');
const defaultCity = computed(() => (import.meta.env.VITE_DEFAULT_CITY as string) ?? '南京市');
</script>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: #364fc7;
  color: #ffffff;
}

.header-bar__branding {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.header-bar__title {
  margin: 0;
  font-size: 1.25rem;
}

.header-bar__subtitle {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.85;
}

.header-bar__nav {
  display: flex;
  gap: 1rem;
}

.header-bar__link {
  color: #ffffff;
  text-decoration: none;
  font-weight: 600;
}

.header-bar__link.router-link-active {
  text-decoration: underline;
}
</style>
