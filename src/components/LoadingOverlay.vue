<template>
  <Teleport to="body">
    <div v-if="overlay" class="overlay" role="dialog" aria-live="polite">
      <div class="overlay__card">
        <div v-if="overlay.type === 'loading'" class="overlay__spinner" aria-hidden="true" />
        <h3 class="overlay__title">{{ title }}</h3>
        <p class="overlay__message">{{ overlay.message }}</p>
        <p v-if="overlay.detail" class="overlay__detail">{{ overlay.detail }}</p>
        <button
          v-if="canClose"
          type="button"
          class="overlay__close"
          @click="emit('close')"
        >
          知道了
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  overlay: { type: 'loading' | 'error' | 'info'; message: string; detail?: string } | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const title = computed(() => {
  if (!props.overlay) return '';
  if (props.overlay.type === 'loading') return '请稍候';
  if (props.overlay.type === 'error') return '出现错误';
  return '提示';
});

const canClose = computed(() => props.overlay?.type !== 'loading');
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.overlay__card {
  width: min(360px, 90vw);
  background: #ffffff;
  border-radius: 1rem;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  text-align: center;
  box-shadow: 0 20px 40px rgba(33, 37, 41, 0.18);
}

.overlay__spinner {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 3px solid #dbe4ff;
  border-top-color: #364fc7;
  margin: 0 auto;
  animation: spin 1s linear infinite;
}

.overlay__title {
  margin: 0;
  font-size: 1.1rem;
}

.overlay__message {
  margin: 0;
  color: #495057;
}

.overlay__detail {
  margin: 0;
  color: #868e96;
  font-size: 0.9rem;
}

.overlay__close {
  align-self: center;
  border: none;
  background: #364fc7;
  color: #ffffff;
  padding: 0.4rem 1rem;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 600;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
