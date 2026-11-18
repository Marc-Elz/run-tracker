<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { useCountdown } from '@/composables/useCountdown'
import { timerPresets } from '@/lib/settings'
import { displaySeconds, presetDetail, totalSeconds, type TimerPreset } from '@/lib/timer'
import { formatMinSec } from '@/lib/training'

const router = useRouter()
const countdown = useCountdown()
const { status, state, phase, next, preset } = countdown

const rounds = computed(() => preset.value?.rounds ?? 1)
const active = computed(() => status.value === 'running' || status.value === 'paused')

const presetLine = (p: TimerPreset) =>
  p.rounds > 1 ? `${presetDetail(p)} · total ${formatMinSec(totalSeconds(p))}` : presetDetail(p)

const phaseLabel = computed(() => {
  if (status.value === 'done') return 'Done'
  if (status.value === 'paused') return 'Paused'
  if (phase.value?.kind === 'rest') return 'Rest'
  return rounds.value > 1 ? 'Work' : (preset.value?.name ?? '')
})

const time = computed(() => formatMinSec(displaySeconds(state.value.remainingMs)))

/** What comes after this phase; nothing for a plain countdown */
const nextLine = computed(() => {
  const p = preset.value
  if (!p) return ''
  if (status.value === 'done') {
    const total = formatMinSec(totalSeconds(p))
    return p.rounds > 1 ? `${p.rounds} rounds · ${total}` : total
  }
  if (p.rounds === 1) return ''
  const n = next.value
  if (!n) return 'Last round'
  return n.kind === 'rest'
    ? `Next: rest ${formatMinSec(p.restS)}`
    : `Next: work ${formatMinSec(p.workS)} · round ${n.round}`
})

// Leaving while a set runs or is paused asks first: back, a tab or ‹ all pass this guard
const confirming = ref(false)
let pending: string | null = null
let leaving = false

onBeforeRouteLeave((to) => {
  if (!active.value || leaving) return true
  pending = to.fullPath
  confirming.value = true
  return false
})

function confirmStop() {
  confirming.value = false
  countdown.stop()
  const to = pending
  pending = null
  if (to) {
    leaving = true
    void router.replace(to)
  }
}

function keepGoing() {
  confirming.value = false
  pending = null
}

/** ‹ and Android back: from a finished set to the list, from the list to where you came from */
function goBack() {
  if (status.value === 'done') {
    countdown.stop()
    return
  }
  if (window.history.state?.back) router.back()
  else void router.replace({ name: 'training' })
}

useBackInterceptor(ref(true), () => {
  if (confirming.value) keepGoing()
  else goBack()
})
</script>

<template>
  <main v-if="status === 'idle'" class="page">
    <header class="bar">
      <button class="back" @click="goBack()">‹ Training</button>
    </header>
    <h1>Timer</h1>
    <ul class="list">
      <li v-for="p in timerPresets" :key="p.id" class="preset">
        <button class="row preset__start" @click="countdown.start(p)">
          <span class="row__main">
            <span class="row__title">{{ p.name }}</span>
            <span class="row__detail">{{ presetLine(p) }}</span>
          </span>
          <span class="row__chevron" aria-hidden="true">▶</span>
        </button>
        <RouterLink
          :to="{ name: 'timer-preset-edit', params: { id: p.id } }"
          class="preset__edit"
          :aria-label="`Edit ${p.name}`"
        >
          Edit
        </RouterLink>
      </li>
    </ul>
    <RouterLink :to="{ name: 'timer-preset-new' }" class="btn btn--primary btn--wide">
      + New preset
    </RouterLink>
  </main>

  <main v-else class="countdown" :data-status="status" :data-phase="phase?.kind ?? 'none'">
    <header class="countdown__head">
      <span class="countdown__phase">{{ phaseLabel }}</span>
      <span v-if="rounds > 1 && phase" class="countdown__round">
        Round {{ phase.round }} / {{ rounds }}
      </span>
    </header>

    <section class="countdown__main">
      <p class="countdown__time" aria-live="off">{{ time }}</p>
      <p v-if="nextLine" class="countdown__next">{{ nextLine }}</p>
    </section>

    <section class="controls">
      <button v-if="status === 'running'" class="cbtn cbtn--secondary" @click="countdown.pause()">
        Pause
      </button>
      <template v-else-if="status === 'paused'">
        <button class="cbtn cbtn--primary" @click="countdown.resume()">Resume</button>
        <button class="cbtn cbtn--danger" @click="countdown.stop()">Stop</button>
      </template>
      <template v-else>
        <button class="cbtn cbtn--primary cbtn--wide" @click="preset && countdown.start(preset)">
          Again
        </button>
        <button class="cbtn cbtn--secondary cbtn--wide" @click="countdown.stop()">
          Back to presets
        </button>
      </template>
    </section>

    <ConfirmDialog
      v-if="confirming"
      title="Stop the timer?"
      confirm-label="Stop"
      @keep="keepGoing()"
      @confirm="confirmStop()"
    >
      The set ends here and is not saved.
    </ConfirmDialog>
  </main>
</template>

<style scoped src="./training.css"></style>

<style scoped>
.page {
  padding-bottom: 1.5rem;
}

.preset {
  display: flex;
  align-items: stretch;
}

/* The whole row starts the preset (one tap for the 2-minute default) */
.preset__start {
  flex: 1;
  min-width: 0;
  border: 0;
  border-top: 1px solid #2a2f36;
  background: none;
  font: inherit;
  text-align: left;
}

.preset__start .row__chevron {
  color: #1f9d55;
  font-size: 1.2rem;
}

.preset__edit {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 4.5rem;
  border-top: 1px solid #2a2f36;
  border-left: 1px solid #2a2f36;
  color: #9aa5b1;
  font-weight: 700;
  text-decoration: none;
}

/* Read at a glance, like the Run screen: one huge number, big buttons at the thumb */
.countdown {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1.5rem;
  padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom));
  background: #101418;
  color: #f4f6f8;
  font-family: system-ui, sans-serif;
}

.countdown__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  font-size: 1.4rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.countdown__phase {
  overflow: hidden;
  color: #1f9d55;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.countdown[data-phase='rest'] .countdown__phase {
  color: #8fb3d9;
}

.countdown[data-status='paused'] .countdown__phase,
.countdown[data-status='done'] .countdown__phase {
  color: #f4f6f8;
}

.countdown__round {
  flex-shrink: 0;
  color: #9aa5b1;
  font-size: 1.1rem;
}

.countdown__main {
  text-align: center;
}

.countdown__time {
  margin: 0;
  font-size: clamp(4.5rem, 26vw, 8rem);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
}

.countdown[data-status='paused'] .countdown__time {
  opacity: 0.6;
}

.countdown__next {
  margin: 1rem 0 0;
  color: #9aa5b1;
  font-size: 1.2rem;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.cbtn {
  flex: 1;
  min-height: 4.5rem;
  border: 0;
  border-radius: 1rem;
  color: #fff;
  font-size: 1.4rem;
  font-weight: 700;
}

.cbtn--wide {
  flex-basis: 100%;
}

.cbtn--primary {
  background: #1f9d55;
}

.cbtn--secondary {
  background: #3b4652;
}

.cbtn--danger {
  background: #d64545;
}
</style>
