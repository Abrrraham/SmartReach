<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="上传数据">
    <div class="modal">
      <header class="modal__header">
        <h3>上传数据</h3>
        <button type="button" class="modal__close" @click="close">×</button>
      </header>
      <form class="modal__body" @submit.prevent="submit">
        <label class="modal__label" for="file-input">选择文件 (GeoJSON / CSV)</label>
        <input
          id="file-input"
          ref="fileInput"
          class="modal__input"
          type="file"
          accept=".json,.geojson,.csv"
          required
        />
        <div class="modal__actions">
          <button type="button" class="button button--ghost" @click="close">取消</button>
          <button type="submit" class="button button--primary">上传</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { csvToGeoJSON } from '../utils/csv';

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'submit', payload: { type: 'geojson' | 'csv'; data: unknown }): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);

function close() {
  emit('close');
}

async function submit() {
  const input = fileInput.value;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    const geojson = csvToGeoJSON(text, {
      lonKey: 'lon',
      latKey: 'lat',
      nameKey: 'name',
      categoryKey: 'category'
    });
    emit('submit', { type: 'csv', data: geojson });
  } else {
    const parsed = JSON.parse(text);
    emit('submit', { type: 'geojson', data: parsed });
  }
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  z-index: 1000;
}

.modal {
  width: min(400px, 100%);
  background: #ffffff;
  border-radius: 0.75rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  background: #364fc7;
  color: #ffffff;
}

.modal__close {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 1.5rem;
  cursor: pointer;
}

.modal__body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
}

.modal__label {
  font-weight: 600;
  color: #343a40;
}

.modal__input {
  border: 1px solid #ced4da;
  border-radius: 0.5rem;
  padding: 0.6rem 0.75rem;
}

.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.button {
  border-radius: 0.5rem;
  border: none;
  padding: 0.6rem 0.9rem;
  cursor: pointer;
  font-weight: 600;
}

.button--ghost {
  background: transparent;
  color: #495057;
  border: 1px solid #adb5bd;
}

.button--primary {
  background: #4263eb;
  color: #ffffff;
}
</style>
