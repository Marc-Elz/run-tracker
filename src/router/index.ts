import { createRouter, createWebHistory } from 'vue-router'
import RunView from '@/views/RunView.vue'
import HistoryView from '@/views/HistoryView.vue'
import HeatmapView from '@/views/HeatmapView.vue'
import SettingsView from '@/views/SettingsView.vue'
import RunSummaryView from '@/views/RunSummaryView.vue'
import TrainingView from '@/views/TrainingView.vue'
import ProgramView from '@/views/ProgramView.vue'
import ProgramFormView from '@/views/ProgramFormView.vue'
import SessionEditorView from '@/views/SessionEditorView.vue'
import { useRunStore } from '@/stores/run'

export const routes = [
  { path: '/', name: 'run', component: RunView },
  { path: '/history', name: 'history', component: HistoryView },
  { path: '/heatmap', name: 'heatmap', component: HeatmapView },
  { path: '/settings', name: 'settings', component: SettingsView },
  { path: '/run/:id', name: 'run-summary', component: RunSummaryView },
  { path: '/training', name: 'training', component: TrainingView },
  { path: '/training/new', name: 'program-new', component: ProgramFormView },
  { path: '/training/:id', name: 'program', component: ProgramView },
  { path: '/training/:id/edit', name: 'program-edit', component: ProgramFormView },
  { path: '/training/:id/session/new', name: 'session-new', component: SessionEditorView },
  { path: '/training/:id/session/:sid', name: 'session-edit', component: SessionEditorView },
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
