import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import https from "https";

const agent = new https.Agent({
  rejectUnauthorized: false,
});

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
      global: {
        fetch: (url, options: any = {}) =>
          fetch(url, { ...options, agent }),
      },
    }
  );
}