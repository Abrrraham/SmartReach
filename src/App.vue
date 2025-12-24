<template>
  <div class="app-shell">
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAppStore } from './store/app';

const store = useAppStore();

onMounted(() => {
  store.initPoiEngine();
});
</script>
