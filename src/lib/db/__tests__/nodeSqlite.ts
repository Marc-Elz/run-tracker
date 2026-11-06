import type { SqlConnection } from '../migrations'

type NodeSqlite = typeof import('node:sqlite')

// Built into Node 22.5+; the repo also allows Node 20, where the real-SQLite tests are skipped
export const nodeSqlite: NodeSqlite | null = await import('node:sqlite').catch(() => null)

/**
 * A real in-memory SQLite database behind the plugin's connection interface, so migrations and
 * repository SQL run for real in unit tests. It copies what the plugin does on Android: `execute`
 * splits on ";\n" and runs the pieces in one transaction, `executeSet` runs a set in one
 * transaction, and foreign keys are on.
 */
export function openTestDb(): SqlConnection {
  if (!nodeSqlite) throw new Error('node:sqlite is not available')
  const db = new nodeSqlite.DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  type Value = null | number | string
  const transaction = (work: () => void) => {
    db.exec('BEGIN')
    try {
      work()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return {
    async execute(statements) {
      transaction(() => {
        for (const statement of statements.split(';\n').filter((s) => s.trim())) db.exec(statement)
      })
    },
    async query(statement, values = []) {
      const rows = db.prepare(statement).all(...(values as Value[]))
      return { values: rows.map((row) => ({ ...row })) }
    },
    async run(statement, values = []) {
      db.prepare(statement).run(...(values as Value[]))
    },
    async executeSet(set) {
      transaction(() => {
        for (const { statement, values } of set) db.prepare(statement).run(...(values as Value[]))
      })
    },
  }
}
