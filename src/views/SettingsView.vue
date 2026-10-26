<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppResume } from '@/composables/useAppResume'
import { openAppSettings, requestLocationPermission } from '@/lib/gps'
import { askBatteryExemption, ensureNotifications, openBatterySettings } from '@/lib/runPower'
import { getTrackingStatus, type TrackingStatus } from '@/lib/trackingStatus'

type Tone = 'ok' | 'warn' | 'unknown' | 'info'
interface Row {
  key: string
  title: string
  tone: Tone
  text: string
  hint?: string
  action?: { label: string; run: () => Promise<unknown> }
  /** Quieter button that opens the Android page where the permission can be taken away */
  secondary?: { label: string; run: () => Promise<unknown> }
}

// undefined while loading, null in the browser
const status = ref<TrackingStatus | null | undefined>(undefined)
const busy = ref<string | null>(null)

async function refresh() {
  status.value = await getTrackingStatus()
}

async function act(row: Row, button: { run: () => Promise<unknown> } | undefined) {
  if (!button || busy.value) return
  busy.value = row.key
  try {
    await button.run()
  } catch (err) {
    console.warn('Settings action failed', err)
  } finally {
    busy.value = null
    await refresh()
  }
}

onMounted(refresh)
useAppResume(refresh)

const SAMSUNG_HINT =
  'Samsung can still stop the app. Settings › Battery › Background usage limits › Never sleeping apps, add Run Tracker.'

const rows = computed<Row[]>(() => {
  const s = status.value
  const units: Row = {
    key: 'units',
    title: 'Units',
    tone: 'info',
    text: 'Metric: km, min/km',
  }
  if (s === undefined) return []
  if (s === null) {
    const phoneOnly = (key: string, title: string): Row => ({
      key,
      title,
      tone: 'unknown',
      text: 'Only available on the phone',
    })
    return [
      phoneOnly('location', 'Location'),
      phoneOnly('notifications', 'Notifications'),
      phoneOnly('battery', 'Battery'),
      units,
    ]
  }

  const unknownText = 'Could not check'
  const permissionAction = (allow: () => Promise<unknown>, state: string) =>
    state === 'prompt'
      ? { label: 'Allow', run: allow }
      : { label: 'Open settings', run: openAppSettings }

  const location: Row =
    s.location === 'granted'
      ? {
          key: 'location',
          title: 'Location',
          tone: 'ok',
          text: 'While using the app. This is enough: the run keeps tracking with the screen off.',
          secondary: { label: 'Revoke in settings', run: openAppSettings },
        }
      : s.location === 'unknown'
        ? { key: 'location', title: 'Location', tone: 'unknown', text: unknownText }
        : {
            key: 'location',
            title: 'Location',
            tone: 'warn',
            text: 'Needed to record a run.',
            action: permissionAction(requestLocationPermission, s.location),
          }

  const notifications: Row =
    s.notifications === 'granted'
      ? {
          key: 'notifications',
          title: 'Notifications',
          tone: 'ok',
          text: 'The "Run in progress" notification shows.',
          secondary: { label: 'Revoke in settings', run: openAppSettings },
        }
      : s.notifications === 'unknown'
        ? { key: 'notifications', title: 'Notifications', tone: 'unknown', text: unknownText }
        : {
            key: 'notifications',
            title: 'Notifications',
            tone: 'warn',
            text: 'Without it the run keeps recording, but the "Run in progress" notification is hidden.',
            action: permissionAction(ensureNotifications, s.notifications),
          }

  const battery: Row =
    s.battery === 'exempt'
      ? {
          key: 'battery',
          title: 'Battery',
          tone: 'ok',
          text: 'Not restricted by battery optimisation.',
          hint: SAMSUNG_HINT,
          secondary: { label: 'Change in settings', run: openBatterySettings },
        }
      : s.battery === 'unknown'
        ? { key: 'battery', title: 'Battery', tone: 'unknown', text: unknownText, hint: SAMSUNG_HINT }
        : {
            key: 'battery',
            title: 'Battery',
            tone: 'warn',
            text: 'Battery optimisation is on, so Android may stop a run.',
            hint: SAMSUNG_HINT,
            action: { label: 'Allow', run: askBatteryExemption },
          }

  return [location, notifications, battery, units]
})

const summary = computed(() => {
  if (status.value === undefined) return ''
  if (status.value === null) return 'The tracking checks show on the phone.'
  const warn = rows.value.filter((r) => r.tone === 'warn').length
  if (warn > 0) return warn === 1 ? '1 thing needs attention' : `${warn} things need attention`
  if (rows.value.some((r) => r.tone === 'unknown')) return 'Some settings could not be checked'
  return 'Ready to track'
})
</script>

<template>
  <main class="settings">
    <h1>Settings</h1>
    <p class="summary" :data-ready="summary === 'Ready to track'">{{ summary }}</p>

    <section v-for="row in rows" :key="row.key" class="row" :data-tone="row.tone">
      <div class="row__head">
        <h2>{{ row.title }}</h2>
        <span v-if="row.tone === 'ok'" class="badge badge--ok">OK</span>
        <span v-else-if="row.tone === 'warn'" class="badge badge--warn">Action needed</span>
      </div>
      <p>{{ row.text }}</p>
      <button
        v-if="row.action"
        class="btn"
        :disabled="busy !== null"
        @click="act(row, row.action)"
      >
        {{ row.action.label }}
      </button>
      <button
        v-if="row.secondary"
        class="btn btn--quiet"
        :disabled="busy !== null"
        @click="act(row, row.secondary)"
      >
        {{ row.secondary.label }}
      </button>
      <p v-if="row.hint" class="hint">{{ row.hint }}</p>
    </section>
  </main>
</template>

<style scoped>
.settings {
  box-sizing: border-box;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem 1.5rem;
  background: #101418;
  color: #f4f6f8;
  font-family: system-ui, sans-serif;
}

h1 {
  margin: 0;
}

.summary {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #f5c451;
}

.summary[data-ready='true'] {
  color: #4cc38a;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem;
  border-radius: 1rem;
  background: #1a2027;
}

.row[data-tone='warn'] {
  background: #3a2a14;
}

.row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

h2 {
  margin: 0;
  font-size: 1.15rem;
}

p {
  margin: 0;
  line-height: 1.4;
}

.badge {
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
}

.badge--ok {
  background: #1f9d55;
  color: #fff;
}

.badge--warn {
  background: #f5c451;
  color: #101418;
}

.hint {
  font-size: 0.9rem;
  color: #9aa5b1;
}

.btn {
  min-height: 3.5rem;
  border: 0;
  border-radius: 1rem;
  background: #3b4652;
  color: #fff;
  font-size: 1.1rem;
  font-weight: 700;
}

.btn--quiet {
  min-height: 3rem;
  background: transparent;
  border: 2px solid #3b4652;
  color: #c5ced8;
  font-size: 1rem;
}

.btn:disabled {
  opacity: 0.6;
}
</style>
