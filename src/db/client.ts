import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sql: NeonQueryFunction<false, false> | null = null;

export function getDb(): NeonQueryFunction<false, false> | null {
  if (sql) return sql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[db] DATABASE_URL not set — DB features disabled");
    return null;
  }

  sql = neon(url);
  console.log("[db] connected to Neon Postgres");
  return sql;
}
