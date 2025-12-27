<template>
  <Teleport to="body">
    <div
      v-if="overlay"
      class="overlay"
      :class="{ 'overlay--toast': isToast }"
      role="dialog"
      aria-live="polite"
    >
      <div class="overlay__card" :class="statusClass">
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
import { computed, onBeforeUnmount, watch } from 'vue';

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

const isToast = computed(() => props.overlay?.type === 'info');
const canClose = computed(() => props.overlay?.type === 'error');
const statusClass = computed(() => {
  if (!props.overlay) return '';
  return `overlay__card--${props.overlay.type}`;
});

let toastTimer: number | null = null;

watch(
  () => props.overlay,
  (next) => {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (next?.type === 'info') {
      toastTimer = window.setTimeout(() => {
        emit('close');
        toastTimer = null;
      }, 2500);
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
});
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 7, 15, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(6px);
}

.overlay--toast {
  background: transparent;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 1.5rem;
  pointer-events: none;
}

.overlay__card {
  width: min(360px, 90vw);
  background: linear-gradient(140deg, rgba(15, 23, 42, 0.95), rgba(12, 20, 35, 0.8));
  border-radius: 1rem;
  border: 1px solid var(--border-soft);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  text-align: center;
  box-shadow: 0 20px 40px rgba(2, 6, 23, 0.45);
  color: var(--text-primary);
  pointer-events: auto;
  animation: tab-fade var(--t-fast) var(--ease-out);
}

.overlay__card--loading {
  border-color: rgba(var(--brand-rgb), 0.35);
  box-shadow: 0 20px 40px rgba(var(--brand-rgb), 0.18);
}

.overlay__card--info {
  border-color: rgba(var(--info-rgb), 0.35);
  box-shadow: 0 20px 40px rgba(var(--info-rgb), 0.18);
}

.overlay__card--error {
  border-color: rgba(var(--danger-rgb), 0.45);
  box-shadow: 0 20px 40px rgba(var(--danger-rgb), 0.22);
}

.overlay--toast .overlay__card {
  width: min(320px, 88vw);
  text-align: left;
  padding: 0.9rem 1.1rem;
  border-radius: 0.9rem;
  box-shadow: 0 16px 32px rgba(2, 6, 23, 0.45);
}

.overlay__spinner {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 3px solid rgba(var(--brand-rgb), 0.25);
  border-top-color: rgba(var(--accent-rgb), 0.9);
  margin: 0 auto;
  animation: spin 1s linear infinite;
}

.overlay__title {
  margin: 0;
  font-size: 1.1rem;
}

.overlay__message {
  margin: 0;
  color: var(--text-secondary);
}

.overlay__detail {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.overlay__close {
  align-self: center;
  border: 1px solid rgba(var(--brand-rgb), 0.4);
  background: rgba(var(--brand-rgb), 0.18);
  color: var(--text-primary);
  padding: 0.4rem 1rem;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 600;
}

.overlay--toast .overlay__close {
  display: none;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
