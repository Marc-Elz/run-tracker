<script setup lang="ts">
const tabs = [
  { to: '/', label: 'Run' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
]
</script>

<template>
  <nav class="tabbar" aria-label="Main">
    <RouterLink v-for="tab in tabs" :key="tab.to" :to="tab.to" replace class="tab">
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  display: flex;
  background: #1a2027;
  border-top: 1px solid #2a2f36;
  padding-bottom: env(safe-area-inset-bottom);
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 3.5rem;
  color: #9aa5b1;
  font: 600 1rem system-ui, sans-serif;
  text-decoration: none;
}

.tab.router-link-exact-active {
  color: #f4f6f8;
  box-shadow: inset 0 3px 0 #1f9d55;
}
</style>
