<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import { useBackButton } from '@/composables/useBackButton'
import { useRunStore } from '@/stores/run'

const { status } = storeToRefs(useRunStore())
// Hidden from Start until Done, so a tap can't leave a run by accident
const runActive = computed(() => status.value !== 'idle')

useBackButton(useRouter(), runActive)
</script>

<template>
  <div class="shell">
    <RouterView />
    <TabBar v-if="!runActive" />
  </div>
</template>

<style>
body {
  margin: 0;
  background: #101418;
}

.shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
</style>
