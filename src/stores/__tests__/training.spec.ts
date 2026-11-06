import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TrainingError, type SessionStep } from '@/lib/training'
import { unavailableTrainingRepository } from '@/lib/db/trainingRepository'
import { useTrainingStore } from '../training'

const program = { name: 'Half', goal: null, weeks: 3, startDate: null }
const easy = (week: number, title = 'Easy') => ({ week, type: 'easy' as const, title, notes: null })

describe('training store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('creates a program with an id and the same creation and update time', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram({ ...program, name: '  Half ' })
    const stored = (await training.getProgram(id))!
    expect(stored.name).toBe('Half')
    expect(stored.createdAt).toBe(stored.updatedAt)
  })

  it('refuses to save a program that breaks a rule, writing nothing', async () => {
    const training = useTrainingStore()
    await expect(training.createProgram({ ...program, name: '' })).rejects.toThrow(TrainingError)
    expect(await training.listPrograms()).toEqual([])
  })

  it('refuses to drop weeks that still hold sessions', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(program)
    await training.saveSession(id, easy(3))
    await expect(training.updateProgram(id, { ...program, weeks: 2 })).rejects.toThrow(
      /Week 3 and later still have 1 session/,
    )
    await training.updateProgram(id, { ...program, weeks: 5 })
    expect((await training.getProgram(id))!.weeks).toBe(5)
  })

  it('adds sessions at the end of their week, and a session moved to another week goes last there', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(program)
    const a = await training.saveSession(id, easy(1, 'A'))
    await training.saveSession(id, easy(2, 'B'))
    await training.saveSession(id, easy(1, 'C'))
    const titles = async () => (await training.listSessions(id)).map((s) => `${s.week}${s.title}`)
    expect(await titles()).toEqual(['1A', '1C', '2B'])

    await training.saveSession(id, easy(1, 'A edited'), a)
    expect(await titles()).toEqual(['1A edited', '1C', '2B'])
    await training.saveSession(id, easy(2, 'A'), a)
    expect(await titles()).toEqual(['1C', '2B', '2A'])
  })

  it('refuses a session outside the program weeks, or one that no longer exists', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(program)
    await expect(training.saveSession(id, easy(4))).rejects.toThrow(/week from 1 to 3/)
    await expect(training.saveSession(id, easy(1), 'gone')).rejects.toThrow(/no longer exists/)
    await expect(training.saveSession('gone', easy(1))).rejects.toThrow(/no longer exists/)
  })

  it('orders and checks steps before storing them, and a rest day drops its steps', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(program)
    const sid = await training.saveSession(id, easy(1))
    const step = (over: Partial<SessionStep>): SessionStep => ({
      id: crypto.randomUUID(),
      sessionId: 'ignored',
      position: 99,
      kind: 'run',
      targetKind: 'none',
      targetValue: null,
      paceMin: null,
      paceMax: null,
      repetitions: null,
      span: null,
      ...over,
    })
    await training.replaceSteps(sid, [step({ kind: 'warmup' }), step({ kind: 'cooldown' })])
    const steps = await training.loadSteps(sid)
    expect(steps.map((s) => [s.kind, s.position, s.sessionId])).toEqual([
      ['warmup', 0, sid],
      ['cooldown', 1, sid],
    ])
    await expect(training.replaceSteps(sid, [step({ repetitions: 2 })])).rejects.toThrow(
      TrainingError,
    )

    await training.saveSession(id, { ...easy(1), type: 'rest' }, sid)
    expect(await training.loadSteps(sid)).toEqual([])
  })

  it('passes the failure on when the database is unavailable', async () => {
    const training = useTrainingStore()
    training.useRepository(unavailableTrainingRepository(new Error('no db')))
    await expect(training.listPrograms()).rejects.toThrow('Database unavailable')
    await expect(training.createProgram(program)).rejects.toThrow('Database unavailable')
  })
})
