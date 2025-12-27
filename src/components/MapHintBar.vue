<template>
  <div class="map-hint" role="status" aria-live="polite">
    <span class="map-hint__text">{{ hint }}</span>
    <button class="map-hint__cancel" type="button" @click="emit('cancel')">取消</button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  hint: string;
}>();

const emit = defineEmits<{
  (event: 'cancel'): void;
}>();
</script>

<style scoped>
.map-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.9rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 16px rgba(33, 37, 41, 0.12);
  color: #343a40;
  font-size: 0.9rem;
  pointer-events: none;
  z-index: 20;
}

.map-hint__text {
  font-weight: 600;
}

.map-hint__cancel {
  pointer-events: auto;
  border: none;
  background: #364fc7;
  color: #ffffff;
  border-radius: 999px;
  padding: 0.2rem 0.7rem;
  font-size: 0.85rem;
  cursor: pointer;
}
</style>
