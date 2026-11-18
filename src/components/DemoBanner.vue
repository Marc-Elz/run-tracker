<script setup lang="ts">
import { ref } from 'vue'

// Web demo only (#162). Closed for the rest of the visit; a reload shows it again, which fits:
// the reload also brought the sample data back.
const open = ref(true)
</script>

<template>
  <div v-if="open" class="demo-banner" role="status">
    <span>Demo: simulated GPS. Runs are lost when you reload.</span>
    <button type="button" aria-label="Close the demo notice" @click="open = false">×</button>
  </div>
</template>

<style scoped>
.demo-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 2px 12px;
  background: #ffd54f;
  color: #101418;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
}

.demo-banner span {
  flex: 1;
}

.demo-banner button {
  min-width: 40px;
  min-height: 32px;
  border: none;
  background: none;
  color: inherit;
  font-size: 20px;
  line-height: 1;
}
</style>
