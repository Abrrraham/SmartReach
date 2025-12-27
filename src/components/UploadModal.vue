<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="上传数据">
    <div class="modal">
      <header class="modal__header">
        <h3>上传数据</h3>
        <button type="button" class="modal__close" @click="close">×</button>
      </header>
      <form class="modal__body" @submit.prevent="submit">
        <label class="modal__label" for="file-input">选择文件（GeoJSON / CSV）</label>
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
      typeKey: 'type_group'
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
  background: rgba(5, 7, 15, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  z-index: 1000;
  backdrop-filter: blur(6px);
}

.modal {
  width: min(400px, 100%);
  background: linear-gradient(140deg, rgba(15, 23, 42, 0.95), rgba(12, 20, 35, 0.8));
  border-radius: 0.9rem;
  box-shadow: 0 18px 36px rgba(2, 6, 23, 0.45);
  border: 1px solid var(--border-soft);
  overflow: hidden;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  background: var(--gradient-header);
  color: var(--text-primary);
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
  color: var(--text-secondary);
}

.modal__input {
  border: 1px solid var(--border-soft);
  border-radius: 0.6rem;
  padding: 0.6rem 0.75rem;
  background: rgba(15, 23, 42, 0.7);
  color: var(--text-primary);
}

.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.button {
  border-radius: 999px;
  border: 1px solid transparent;
  padding: 0.6rem 0.9rem;
  cursor: pointer;
  font-weight: 600;
  transition:
    transform var(--t-fast) var(--ease-out),
    border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.button--ghost {
  background: rgba(15, 23, 42, 0.5);
  color: var(--text-primary);
  border: 1px solid var(--border-soft);
}

.button--primary {
  background: var(--gradient-primary);
  color: var(--text-on-brand);
  box-shadow: 0 12px 24px rgba(var(--brand-rgb), 0.28);
}

.button:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-soft);
}
</style>
