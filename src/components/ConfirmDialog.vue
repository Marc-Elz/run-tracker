<script setup lang="ts">
defineProps<{ title: string; busy?: boolean; error?: string | null }>()
defineEmits<{ keep: []; confirm: [] }>()
</script>

<template>
  <div class="backdrop" @click.self="!busy && $emit('keep')">
    <div class="dialog" role="alertdialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <p><slot /></p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button class="btn btn--secondary" :disabled="busy" autofocus @click="$emit('keep')">
          Keep
        </button>
        <button class="btn btn--danger" :disabled="busy" @click="$emit('confirm')">Delete</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgb(0 0 0 / 0.65);
}

.dialog {
  width: 100%;
  max-width: 24rem;
  box-sizing: border-box;
  padding: 1.25rem;
  border-radius: 1rem;
  background: #1a2027;
  color: #f4f6f8;
  font-family: system-ui, sans-serif;
}

h2 {
  margin: 0 0 0.5rem;
  font-size: 1.3rem;
}

p {
  margin: 0 0 1rem;
  line-height: 1.4;
  color: #c3ccd5;
}

.error {
  color: #ffb3b3;
}

.actions {
  display: flex;
  gap: 1rem;
}

.btn {
  flex: 1;
  min-height: 4rem;
  border: 0;
  border-radius: 1rem;
  font-size: 1.2rem;
  font-weight: 700;
  color: #fff;
}

.btn--secondary {
  background: #3b4652;
}

.btn--danger {
  background: #d64545;
}

.btn:disabled {
  opacity: 0.6;
}
</style>
