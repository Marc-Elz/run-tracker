/** The part of a database connection the migration runner needs (matches SQLiteDBConnection) */
export interface SqlDb {
  /** Runs several statements in one transaction */
  execute(statements: string): Promise<unknown>
  query(statement: string): Promise<{ values?: Record<string, unknown>[] }>
}

/**
 * Schema changes, oldest first; never edit one that has shipped, add a new one.
 * Every statement must end with ";" plus a newline: on Android the plugin splits on exactly
 * that, and runs only the first statement of each piece. No "--" comments: it strips them.
 * All times are UTC epoch milliseconds.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'finished')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  segment INTEGER NOT NULL DEFAULT 0,
  segment_started_at INTEGER,
  moving_ms INTEGER NOT NULL DEFAULT 0,
  distance_m REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE track_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  segment INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  accuracy REAL,
  altitude REAL,
  speed REAL
);
CREATE INDEX track_points_run ON track_points (run_id, segment, timestamp);
`,
]

export async function schemaVersion(db: SqlDb): Promise<number> {
  const result = await db.query('PRAGMA user_version;')
  return Number(result.values?.[0]?.user_version ?? 0)
}

/**
 * Bring the schema up to date. The version lives in `PRAGMA user_version`; each migration and
 * its version bump go in one `execute`, which the plugin wraps in a transaction.
 */
export async function migrate(db: SqlDb): Promise<number> {
  const current = await schemaVersion(db)
  if (current > MIGRATIONS.length) {
    throw new Error(`Database version ${current} is newer than this app (${MIGRATIONS.length})`)
  }
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    await db.execute(`${MIGRATIONS[version - 1]}PRAGMA user_version = ${version};\n`)
    console.info('[db] migrated to version', version)
  }
  return MIGRATIONS.length
}
