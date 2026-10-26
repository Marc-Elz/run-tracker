import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useRunStore } from './stores/run'
import { openRunRepository, unavailableRunRepository } from './lib/db/runRepository'

async function boot() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  // Open storage and bring back a run the app was killed in, before the first screen shows
  const run = useRunStore(pinia)
  try {
    run.useRepository(await openRunRepository())
    await run.recover()
  } catch (err) {
    console.warn('[db] could not open or recover', err)
    run.useRepository(unavailableRunRepository(err))
  }

  app.mount('#app')
}

void boot()
