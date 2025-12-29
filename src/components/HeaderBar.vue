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
import { APP_NAME, DEFAULT_CITY } from '../config/env';

const appName = computed(() => APP_NAME);
const defaultCity = computed(() => DEFAULT_CITY);
</script>

<style scoped>
.header-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.75rem;
  background:
    linear-gradient(135deg, rgba(var(--brand-rgb), 0.12), rgba(var(--accent-rgb), 0.18)),
    rgba(12, 20, 35, 0.92);
  border-bottom: 1px solid var(--border-soft);
  box-shadow: 0 14px 28px rgba(2, 6, 23, 0.35);
  backdrop-filter: blur(16px);
}

.header-bar__branding {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.header-bar__title {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: 0.4px;
}

.header-bar__subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.header-bar__nav {
  display: flex;
  gap: 0.75rem;
}

.header-bar__link {
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid transparent;
  transition:
    transform var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.header-bar__link.router-link-active {
  background: rgba(var(--brand-rgb), 0.16);
  border-color: rgba(var(--brand-rgb), 0.35);
  color: var(--text-primary);
  box-shadow: 0 0 0 1px rgba(var(--brand-rgb), 0.15);
}

.header-bar__link:hover {
  transform: translateY(-1px);
  background: rgba(15, 23, 42, 0.6);
  border-color: var(--border-strong);
}
</style>
