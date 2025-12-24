<template>
  <div class="workbench">
    <HeaderBar />
    <div class="workbench__body">
      <SidePanel
        @request-isochrone="handleGenerateIsochrone"
        @export-poi-csv="exportPoiCsv"
        @export-candidate-csv="exportCandidateCsv"
        @export-map-png="exportMapPng"
        @fit-nanjing="handleFitNanjing"
        @upload="handleUpload"
      />
      <main class="workbench__map">
        <MapView
          ref="mapViewRef"
          @map-click="handleMapClick"
          @click-poi="handlePoiClick"
        />
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
const lastOrigin = ref<[number, number] | null>(null);

const store = useAppStore();
const { data, filters, visiblePoisInIsochrone } = storeToRefs(store);

function handleMapClick(coordinates: [number, number]) {
  lastOrigin.value = coordinates;
  store.generateIsochrones(coordinates);
}

function handleGenerateIsochrone() {
  if (lastOrigin.value) {
    store.generateIsochrones(lastOrigin.value);
  }
}

function handlePoiClick(poi: POI) {
  if (!lastOrigin.value) {
    return;
  }
  store.planRouteToPoi(poi, lastOrigin.value);
}

function exportPoiCsv() {
  const rows = [
    ['id', 'name', 'type_group', 'lon', 'lat', 'address'].join(',')
  ];
  visiblePoisInIsochrone.value.forEach((poi) => {
    rows.push(
      [
        poi.id,
        poi.name,
        poi.type_group,
        poi.lon.toFixed(6),
        poi.lat.toFixed(6),
        poi.address ?? ''
      ].join(',')
    );
  });
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `${filters.value.travelMode}_isochrone_pois.csv`);
}

function exportCandidateCsv() {
  const rows = [['id', 'name', 'type_group', 'lon', 'lat', 'score'].join(',')];
  data.value.candidates.forEach((candidate) => {
    rows.push(
      [
        candidate.id,
        candidate.name,
        candidate.type_group,
        candidate.lon.toFixed(6),
        candidate.lat.toFixed(6),
        candidate.score ?? ''
      ].join(',')
    );
  });
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, 'candidate_scores.csv');
}

function exportMapPng() {
  const dataUrl = mapViewRef.value?.getMapDataUrl();
  if (!dataUrl) return;
  const byteString = atob(dataUrl.split(',')[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const intArray = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i += 1) {
    intArray[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([arrayBuffer], { type: 'image/png' });
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

