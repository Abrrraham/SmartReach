<template>
  <div class="app-shell">
    <RouterView />
    <LoadingOverlay :overlay="ui.overlay" @close="store.hideOverlay()" />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from './store/app';
import LoadingOverlay from './components/LoadingOverlay.vue';

const store = useAppStore();
const { ui } = storeToRefs(store);

onMounted(() => {
  store.initPoiEngine();
});
</script>
