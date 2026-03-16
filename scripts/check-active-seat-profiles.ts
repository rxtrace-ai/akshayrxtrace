import { Client } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL (or SUPABASE_DB_URL) is required");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query(
      `
      SELECT count(*)::int AS missing_count
      FROM public.seats s
      LEFT JOIN public.user_profiles p ON p.user_id = s.user_id
      WHERE s.user_id IS NOT NULL
        AND s.status = 'active'
        AND coalesce(s.active, false) = true
        AND p.user_id IS NULL
      `
    );

    const missing = Number(result.rows?.[0]?.missing_count || 0);
    if (missing > 0) {
      console.error(`ERROR: active seats missing user profiles (${missing})`);
      process.exit(1);
    }

    console.log("OK: no active seats are missing user profiles");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("ERROR: seat/profile health check failed", err);
  process.exit(1);
});

