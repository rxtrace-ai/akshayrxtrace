import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const normalizedEmail = user.email ? String(user.email).toLowerCase().trim() : null;
    const fullName =
      (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
      null;

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to ensure profile" }, { status: 500 });
  }
}
