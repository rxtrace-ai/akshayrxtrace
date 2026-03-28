import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// GET: Public API - Fetch active add-ons
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data, error } = await supabase
      .from("add_ons")
      .select("id, name, description, price, unit, pricing_unit_size, duration_days, recurring, addon_kind, entitlement_key, billing_mode")
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (error) throw error;
    return apiJson({ success: true, add_ons: data || [] });
  } catch (err: any) {
    return apiJson({ success: false, error: err.message }, { status: 500 });
  }
}

