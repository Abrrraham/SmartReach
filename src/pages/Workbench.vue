<template>
  <div class="workbench">
    <HeaderBar />
    <div class="workbench__body">
      <SidePanel
        @export-poi-csv="exportPoiCsv"
        @export-candidate-csv="exportCandidateCsv"
        @export-map-png="exportMapPng"
        @fit-nanjing="handleFitNanjing"
        @upload="handleUpload"
      />
      <main class="workbench__map">
        <MapView ref="mapViewRef" @click-poi="handlePoiClick" />
      </main>
      <ResultPanel @navigate="handlePoiClick" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { saveAs } from 'file-saver';
import HeaderBar from '../components/HeaderBar.vue';
import MapView from '../components/MapView.vue';
import SidePanel from '../components/SidePanel.vue';
import ResultPanel from '../components/ResultPanel.vue';
import { useAppStore } from '../store/app';
import type { POI } from '../types/poi';

const mapViewRef = ref<InstanceType<typeof MapView> | null>(null);

const store = useAppStore();
const { data, filters, visiblePoisInIsochrone } = storeToRefs(store);

function handlePoiClick(poi: POI) {
  store.planRouteToPoi(poi);
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportPoiCsv() {
  const rows = [
    ['id', 'name', 'type_group', 'lon', 'lat', 'address'].map(escapeCsv).join(',')
  ];
  visiblePoisInIsochrone.value.forEach((poi) => {
    rows.push(
      [
        escapeCsv(poi.id),
        escapeCsv(poi.name),
        escapeCsv(poi.type_group),
        escapeCsv(poi.lon.toFixed(6)),
        escapeCsv(poi.lat.toFixed(6)),
        escapeCsv(poi.address ?? '')
      ].join(',')
    );
  });
  const csv = `\ufeff${rows.join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `${filters.value.travelMode}_isochrone_pois.csv`);
}

function exportCandidateCsv() {
  const rows = [['id', 'name', 'type_group', 'lon', 'lat', 'score'].map(escapeCsv).join(',')];
  data.value.candidates.forEach((candidate) => {
    rows.push(
      [
        escapeCsv(candidate.id),
        escapeCsv(candidate.name),
        escapeCsv(candidate.type_group),
        escapeCsv(candidate.lon.toFixed(6)),
        escapeCsv(candidate.lat.toFixed(6)),
        escapeCsv(candidate.score ?? '')
      ].join(',')
    );
  });
  const csv = `\ufeff${rows.join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, 'candidate_scores.csv');
}

async function exportMapPng() {
  const dataUrl = await mapViewRef.value?.getMapDataUrl();
  if (!dataUrl) return;
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const city = (import.meta.env.VITE_DEFAULT_CITY as string | undefined) || '南京市';
  saveAs(blob, `${city}-map-${date}.png`);
}

function handleFitNanjing() {
  mapViewRef.value?.fitToNanjing?.();
}

function handleUpload(payload: { type: 'geojson' | 'csv'; data: any }) {
  const features = payload.data.features ?? [];
  features.forEach((feature: any, index: number) => {
    const props = feature.properties ?? {};
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      return;
    }
    store.addCandidate({
      id: props.id ?? `candidate-${index}`,
      name: props.name ?? `候选点-${index}`,
      type_group: props.type_group ?? props.category ?? 'other',
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      address: props.address,
      metrics: props.metrics
    });
  });
}
</script>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
}

.workbench__body {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: auto 1fr auto;
  height: 100%;
  min-height: 0;
}

.workbench__map {
  position: relative;
  height: 100%;
  min-height: 0;
}
</style>

