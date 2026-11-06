import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { migrate, type SqlConnection } from './migrations'

const DB_NAME = 'runtracker'

/**
 * Open the app database and bring its schema up to date. Call it once (see `openRepositories`):
 * the run and training repositories share this one connection.
 */
export async function openDb(): Promise<SqlConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite)
  // The native side outlives a WebView reload; this closes connections JS no longer knows
  // about, so the create below doesn't fail with "Connection runtracker already exists"
  const consistent = (await sqlite.checkConnectionsConsistency()).result
  const exists = (await sqlite.isConnection(DB_NAME, false)).result
  const db =
    consistent && exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
  if (!(await db.isDBOpen()).result) await db.open()
  await migrate(db)
  return db
}
