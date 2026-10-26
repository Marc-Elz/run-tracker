import { describe, expect, it, vi } from 'vitest'
import { MIGRATIONS, migrate, type SqlDb } from '../migrations'

/**
 * Behaves like the plugin's connection: one `execute` is one transaction, so either all of
 * its statements apply (including the user_version bump) or none do.
 */
function fakeDb(version = 0, failOn?: RegExp) {
  const state = { version, executed: [] as string[] }
  const db: SqlDb = {
    execute: vi.fn<(sql: string) => Promise<void>>(async (sql: string) => {
      if (failOn?.test(sql)) throw new Error('table already exists')
      const bump = /PRAGMA user_version = (\d+);\n$/.exec(sql)
      state.executed.push(sql)
      if (bump) state.version = Number(bump[1])
    }),
    query: vi.fn<SqlDb['query']>(async () => ({ values: [{ user_version: state.version }] })),
  }
  return { db, state }
}

describe('migrate', () => {
  it('runs every migration on a fresh database and records the version', async () => {
    const { db, state } = fakeDb()
    expect(await migrate(db)).toBe(MIGRATIONS.length)
    expect(state.executed).toHaveLength(MIGRATIONS.length)
    expect(state.version).toBe(MIGRATIONS.length)
  })

  it('runs nothing when the schema is up to date', async () => {
    const { db } = fakeDb(MIGRATIONS.length)
    await migrate(db)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('keeps the old version when a migration fails', async () => {
    const { db, state } = fakeDb(0, /CREATE TABLE runs/)
    await expect(migrate(db)).rejects.toThrow('table already exists')
    expect(state.version).toBe(0)
  })

  it('refuses a database from a newer app version', async () => {
    const { db } = fakeDb(MIGRATIONS.length + 1)
    await expect(migrate(db)).rejects.toThrow('newer than this app')
  })

  it('sends the version bump in the same execute as the migration', async () => {
    const { db } = fakeDb()
    await migrate(db)
    expect(vi.mocked(db.execute).mock.calls[0]![0]).toMatch(/PRAGMA user_version = 1;\n$/)
  })

  // The plugin splits on ";\n" and strips "--" comments; anything else breaks on the phone
  it.each(MIGRATIONS.map((sql, i) => [i + 1, sql] as const))(
    'migration %i is written the way the plugin splits it',
    (_version, sql) => {
      expect(sql.endsWith(';\n')).toBe(true)
      expect(sql).not.toContain('--')
      const statements = sql.split(';\n').filter((s) => s.trim())
      for (const statement of statements) expect(statement).not.toContain(';')
    },
  )
})
