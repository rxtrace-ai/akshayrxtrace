import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return apiJson({ error: "Unauthorized" }, { status: 401 });
    }

    const normalizedEmail = user.email ? String(user.email).toLowerCase().trim() : null;
    const fullName =
      (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
      normalizedEmail ||
      "";

    const { error } = await supabase.from("user_profiles").upsert(
      {
        id: user.id,
        user_id: user.id,
        email: normalizedEmail,
        full_name: fullName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      return apiJson({ error: error.message }, { status: 500 });
    }

    return apiJson({ success: true });
  } catch (error: any) {
    return apiJson({ error: error?.message || "Failed to ensure profile" }, { status: 500 });
  }
}

