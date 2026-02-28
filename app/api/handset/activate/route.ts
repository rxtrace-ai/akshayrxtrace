export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { requireUserSession } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";

export async function POST(req: Request) {
  try {
    const auth = await requireUserSession();
    if ("error" in auth) return auth.error;
    const supabase = await supabaseServer();

    const payload = (await req.json().catch(() => ({}))) as {
      tokenNumber?: string;
      deviceName?: string;
    };
    const { tokenNumber, deviceName } = payload;

    if (!tokenNumber || !deviceName) {
      return NextResponse.json(
        { success: false, error: "tokenNumber and deviceName required" },
        { status: 400 }
      );
    }

    const now = new Date();
    const userId = auth.userId;
    const companyId = await resolveCompanyIdFromRequest(req);

    if (!companyId) {
      return NextResponse.json({ success: false, error: "No company found" }, { status: 403 });
    }

    const snapshot = await getCompanyEntitlementSnapshot(supabase, companyId);
    const handsetLimit = Number(snapshot.limits?.handset ?? 0);
    const handsetRemaining = Number(snapshot.remaining?.handset ?? 0);
    const entitlementEnabled = handsetLimit > 0;

    if (entitlementEnabled) {
      if (snapshot.state === "TRIAL_EXPIRED") {
        return NextResponse.json({ success: false, error: "TRIAL_EXPIRED" }, { status: 403 });
      }
      if (snapshot.state === "NO_ACTIVE_SUBSCRIPTION") {
        return NextResponse.json({ success: false, error: "NO_ACTIVE_SUBSCRIPTION" }, { status: 403 });
      }
      if (handsetRemaining <= 0) {
        return NextResponse.json({ success: false, error: "HANDSET_QUOTA_EXCEEDED" }, { status: 403 });
      }
    }

    const { data: tokenRecord, error: tokenError } = await supabase
      .from("token")
      .select("*")
      .eq("tokennumber", tokenNumber)
      .eq("userid", userId)
      .maybeSingle();
    if (tokenError) {
      throw new Error(tokenError.message);
    }
    if (!tokenRecord) {
      throw new Error("Invalid activation token");
    }

    if (tokenRecord.status !== "ACTIVE") {
      throw new Error("Token is not active");
    }

    if (new Date(tokenRecord.expiry) <= now) {
      throw new Error("Token has expired");
    }

    if (Number(tokenRecord.activationcount) >= Number(tokenRecord.maxactivations)) {
      throw new Error("Token activation limit reached");
    }

    const { data: handset, error: handsetError } = await supabase
      .from("handset")
      .insert({
        userid: userId,
        ...(companyId ? { company_id: companyId } : {}),
        devicename: deviceName,
        tokenid: tokenRecord.id,
        activatedat: now.toISOString(),
        active: true,
      })
      .select("*")
      .single();
    if (handsetError) {
      throw new Error(handsetError.message);
    }

    const { error: tokenUpdateError } = await supabase
      .from("token")
      .update({
        activationcount: Number(tokenRecord.activationcount) + 1,
      })
      .eq("id", tokenRecord.id);
    if (tokenUpdateError) {
      throw new Error(tokenUpdateError.message);
    }

    const jwtToken = jwt.sign(
      {
        handset_id: handset.id,
        user_id: userId,
        ...(companyId ? { company_id: companyId } : {}),
        role: "HIGH_SCAN",
      },
      process.env.JWT_SECRET!,
      { expiresIn: "180d" }
    );

    return NextResponse.json({
      success: true,
      jwt: jwtToken,
      token: tokenRecord.tokennumber,
      handset_id: handset.id,
      activated_at: new Date(handset.activatedat).toISOString(),
    });
  } catch (err: any) {
    console.error("Handset activation error:", err);

    return NextResponse.json(
      { success: false, error: err?.message || "Activation failed" },
      { status: 400 }
    );
  }
}
