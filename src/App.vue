<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import { useBackButton } from '@/composables/useBackButton'
import { useRunStore } from '@/stores/run'

const { status } = storeToRefs(useRunStore())
// Hidden from Start until Done, so a tap can't leave a run by accident
const runActive = computed(() => status.value !== 'idle')
// Web demo for GitHub Pages only (#162). The flag is replaced at build time, so other builds
// leave the banner out of the bundle.
const DemoBanner =
  import.meta.env.VITE_DEMO === 'true'
    ? defineAsyncComponent(() => import('@/components/DemoBanner.vue'))
    : null

useBackButton(useRouter(), runActive)
</script>

<template>
  <div class="shell">
    <component :is="DemoBanner" v-if="DemoBanner" />
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
