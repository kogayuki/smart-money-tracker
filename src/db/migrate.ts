import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NeonQueryFunction } from "@neondatabase/serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

export async function runMigrations(sql: NeonQueryFunction<false, false>): Promise<void> {
  // Ensure migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id    SERIAL PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      run_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Get already-applied migrations
  const applied = await sql`SELECT name FROM _migrations ORDER BY name`;
  const appliedSet = new Set(applied.map((r) => r.name as string));

  // Read migration files sorted by name
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[migrate] skip ${file} (already applied)`);
      continue;
    }

    const content = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`[migrate] applying ${file}...`);

    // Neon HTTP driver doesn't support multiple statements per query.
    // Split on semicolons and execute each statement individually.
    const statements = content
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await sql(stmt);
    }

    await sql`INSERT INTO _migrations (name) VALUES (${file})`;
    console.log(`[migrate] applied ${file}`);
  }
}
