import { createRouter, createWebHistory } from 'vue-router'
import RunView from '@/views/RunView.vue'
import HistoryView from '@/views/HistoryView.vue'
import SettingsView from '@/views/SettingsView.vue'
import RunSummaryView from '@/views/RunSummaryView.vue'
import { useRunStore } from '@/stores/run'

export const routes = [
  { path: '/', name: 'run', component: RunView },
  { path: '/history', name: 'history', component: HistoryView },
  { path: '/settings', name: 'settings', component: SettingsView },
  { path: '/run/:id', name: 'run-summary', component: RunSummaryView },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// A run in progress keeps you on the run screen until it is stopped and saved
router.beforeEach((to) => {
  if (to.name !== 'run' && useRunStore().status !== 'idle') return { name: 'run' }
})

export default router
