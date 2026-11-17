import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useRunStore } from './stores/run'
import { useTrainingStore } from './stores/training'
import { openRepositories, type Repositories } from './lib/db/repositories'
import { unavailableRunRepository } from './lib/db/runRepository'
import { unavailableTrainingRepository } from './lib/db/trainingRepository'
import { clearSharedFiles } from './lib/shareRun'

async function boot() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  // Open storage and bring back a run the app was killed in, before the first screen shows
  const run = useRunStore(pinia)
  const training = useTrainingStore(pinia)
  let repos: Repositories | null = null
  try {
    repos = await openRepositories()
  } catch (err) {
    console.warn('[db] could not open', err)
    run.useRepository(unavailableRunRepository(err))
    training.useRepository(unavailableTrainingRepository(err))
  }
  // Web demo only (#162): the constant is replaced at build time, so other builds leave the seed
  // file out. Straight into the empty in-memory repositories, before the stores read them.
  if (import.meta.env.VITE_DEMO === 'true' && repos) {
    const { run: runRepo, training: trainingRepo } = repos
    try {
      const { seedDemo } = await import('./demo/seedDemo')
      await seedDemo({
        importRun: (r, points, steps) => runRepo.importRun(r, points, steps),
        importProgram: (bundle) => trainingRepo.importProgram(bundle),
      })
    } catch (err) {
      console.warn('[demo] could not add the sample data', err)
    }
  }
  if (repos) {
    training.useRepository(repos.training)
    try {
      run.useRepository(repos.run)
      await run.recover()
    } catch (err) {
      console.warn('[db] could not recover', err)
      run.useRepository(unavailableRunRepository(err))
    }
  }

  void clearSharedFiles()
  app.mount('#app')
}

void boot()
