import { Capacitor } from '@capacitor/core'
import { createMemoryRunRepository } from './memoryRunRepository'
import { createMemoryTrainingRepository } from './memoryTrainingRepository'
import { createQueue, serialized, type RunRepository } from './runRepository'
import { serializedTraining, type TrainingRepository } from './trainingRepository'

export interface Repositories {
  run: RunRepository
  training: TrainingRepository
}

/**
 * SQLite on the phone, in memory in the browser (where nothing needs to survive a reload, and
 * the dev server and GPS simulator work without a database). On the phone both repositories
 * share one connection and one write queue.
 */
export async function openRepositories(): Promise<Repositories> {
  if (!Capacitor.isNativePlatform()) {
    return { run: createMemoryRunRepository(), training: createMemoryTrainingRepository() }
  }
  const [{ openDb }, { createSqliteRunRepository }, { createSqliteTrainingRepository }] =
    await Promise.all([
      import('./connection'),
      import('./sqliteRunRepository'),
      import('./sqliteTrainingRepository'),
    ])
  const db = await openDb()
  const queue = createQueue()
  return {
    run: serialized(createSqliteRunRepository(db), queue),
    training: serializedTraining(createSqliteTrainingRepository(db), queue),
  }
}
