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
const demo = import.meta.env.VITE_DEMO === 'true'
const DemoBanner = demo ? defineAsyncComponent(() => import('@/components/DemoBanner.vue')) : null
// The demo's phone-width column (#166); worked out here so other builds reduce it to 'shell'
const shellClass = demo ? 'shell shell--demo' : 'shell'

useBackButton(useRouter(), runActive)
</script>

<template>
  <div :class="shellClass">
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

/*
 * Web demo only (#166): on a wide screen the app keeps the phone's proportions, a 412 px column
 * on a near-black page. Not in the APK, where a phone in landscape should use its full width.
 * The box-shadow is a border that adds no width; on a phone-width window it falls outside the
 * screen. `contain: layout` makes the column the containing block of `position: fixed`
 * descendants, so dialog backdrops cover the column instead of the whole window.
 */
.shell--demo {
  max-width: 412px;
  margin: 0 auto;
  box-shadow: 0 0 0 1px #2a323b;
  contain: layout;
}

body:has(.shell--demo) {
  background: #050607;
}
</style>
