<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { setTimerPresets, timerPresets } from '@/lib/settings'
import {
  autoPresetName,
  DEFAULT_PRESET_ID,
  MAX_ROUNDS,
  presetError,
  totalSeconds,
  type TimerPreset,
} from '@/lib/timer'
import { formatMinSec, parseMinSec } from '@/lib/training'

const route = useRoute()
const router = useRouter()
const leave = useLeaveScreen(() => ({ name: 'timer' }))

// One-tap values (as #143): seconds
const WORK_CHIPS = [30, 45, 60, 90, 120]
const REST_CHIPS = [0, 10, 15, 30, 60]

const id = computed(() => (route.params.id as string | undefined) ?? undefined)
const existing = computed(() =>
  id.value === undefined ? null : (timerPresets.value.find((p) => p.id === id.value) ?? null),
)
const missing = computed(() => id.value !== undefined && existing.value === null)
const isDefault = computed(() => id.value === DEFAULT_PRESET_ID)

const start = existing.value
const form = ref({
  name: start?.name ?? '',
  work: formatMinSec(start?.workS ?? 60),
  rest: start && start.restS > 0 ? formatMinSec(start.restS) : '',
  rounds: start?.rounds ?? 1,
})
const error = ref<string | null>(null)
const confirming = ref(false)

useBackInterceptor(confirming, () => (confirming.value = false))

/** Empty rest means none; otherwise min:s like the work time */
const restSeconds = (text: string) => (text.trim() === '' ? 0 : parseMinSec(text))

const values = computed(() => ({
  workS: parseMinSec(form.value.work) ?? NaN,
  restS: restSeconds(form.value.rest) ?? NaN,
  rounds: form.value.rounds,
}))

const total = computed(() =>
  presetError(values.value) === null ? formatMinSec(totalSeconds(values.value)) : null,
)

function changeRounds(by: number) {
  form.value.rounds = Math.min(MAX_ROUNDS, Math.max(1, form.value.rounds + by))
}

function save() {
  const v = values.value
  const problem = presetError(v)
  if (problem) {
    error.value = problem
    return
  }
  const preset: TimerPreset = {
    id: id.value ?? crypto.randomUUID(),
    name: form.value.name.trim() || autoPresetName(v),
    ...v,
  }
  const list = id.value
    ? timerPresets.value.map((p) => (p.id === id.value ? preset : p))
    : [...timerPresets.value, preset]
  if (!setTimerPresets(list)) {
    error.value = "Couldn't save on this phone."
    return
  }
  leave()
}

function onDelete() {
  if (!setTimerPresets(timerPresets.value.filter((p) => p.id !== id.value))) {
    confirming.value = false
    error.value = "Couldn't save on this phone."
    return
  }
  confirming.value = false
  leave()
}
</script>

<template>
  <main class="page">
    <header class="bar">
      <button class="back" @click="leave()">‹ Cancel</button>
      <button v-if="!missing" class="back" @click="save()">Save</button>
    </header>

    <section v-if="missing" class="message">
      <p>This preset no longer exists</p>
      <button class="btn" @click="router.replace({ name: 'timer' })">Back to Timer</button>
    </section>

    <template v-else>
      <h1>{{ existing ? `Edit ${existing.name}` : 'New preset' }}</h1>
      <form class="form" @submit.prevent="save()">
        <label class="label" for="preset-name">Name</label>
        <input
          id="preset-name"
          v-model="form.name"
          class="input"
          type="text"
          :placeholder="total ? autoPresetName(values) : 'Optional'"
        />

        <label class="label" for="preset-work">Work</label>
        <div class="choices choices--chips" role="group" aria-label="Common work times">
          <button
            v-for="s in WORK_CHIPS"
            :key="s"
            type="button"
            class="btn"
            :aria-pressed="values.workS === s"
            @click="form.work = formatMinSec(s)"
          >
            {{ formatMinSec(s) }}
          </button>
        </div>
        <input
          id="preset-work"
          v-model="form.work"
          class="input"
          type="text"
          inputmode="text"
          placeholder="min:s"
        />

        <label class="label" for="preset-rest">Rest between rounds</label>
        <div class="choices choices--chips" role="group" aria-label="Common rest times">
          <button
            v-for="s in REST_CHIPS"
            :key="s"
            type="button"
            class="btn"
            :aria-pressed="values.restS === s"
            @click="form.rest = s === 0 ? '' : formatMinSec(s)"
          >
            {{ s === 0 ? 'None' : formatMinSec(s) }}
          </button>
        </div>
        <input
          id="preset-rest"
          v-model="form.rest"
          class="input"
          type="text"
          inputmode="text"
          placeholder="None"
        />

        <span id="preset-rounds" class="label">Rounds</span>
        <div class="stepper" role="group" aria-labelledby="preset-rounds">
          <button
            type="button"
            class="btn"
            aria-label="Fewer rounds"
            :disabled="form.rounds <= 1"
            @click="changeRounds(-1)"
          >
            −
          </button>
          <span class="stepper__value" aria-live="polite">{{ form.rounds }}×</span>
          <button
            type="button"
            class="btn"
            aria-label="More rounds"
            :disabled="form.rounds >= MAX_ROUNDS"
            @click="changeRounds(1)"
          >
            +
          </button>
        </div>
        <p v-if="total" class="hint">
          Total {{ total }}{{ form.rounds > 1 ? ' (no rest after the last round)' : '' }}
        </p>
        <p v-if="isDefault" class="hint">This preset can't be deleted.</p>

        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      </form>

      <button
        v-if="existing && !isDefault"
        class="btn btn--danger btn--wide"
        @click="confirming = true"
      >
        Delete preset
      </button>
    </template>

    <ConfirmDialog
      v-if="confirming && existing"
      :title="`Delete ${existing.name}?`"
      @keep="confirming = false"
      @confirm="onDelete()"
    >
      The preset is removed from this phone.
    </ConfirmDialog>
  </main>
</template>

<style scoped src="./training.css"></style>
