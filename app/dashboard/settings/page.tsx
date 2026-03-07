"use client";

import { useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import TaxSettingsPanel from "@/components/settings/TaxSettingsPanel";
import { supabaseClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const router = useRouter();
  const { trialSummary, loading: trialLoading, error: trialError, refresh: refreshTrial } = useSubscription();
  const [trialActivating, setTrialActivating] = useState(false);
  const [trialActivateError, setTrialActivateError] = useState<string | null>(null);

  async function loadRazorpayScript(): Promise<void> {
    if (typeof window === "undefined") return;
    if ((window as any).Razorpay) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("RAZORPAY_SCRIPT_LOAD_FAILED")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("RAZORPAY_SCRIPT_LOAD_FAILED"));
      document.body.appendChild(script);
    });
    if (!(window as any).Razorpay) throw new Error("RAZORPAY_SDK_NOT_AVAILABLE");
  }

  async function handleActivateTrial() {
    setTrialActivateError(null);
    setTrialActivating(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch("/api/user/trial/activate/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ idempotency_key: idempotencyKey }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "TRIAL_ACTIVATION_INIT_FAILED");
      }

      await loadRazorpayScript();
      const RazorpayCtor = (window as any).Razorpay;

      await new Promise<void>((resolve) => {
        const rzp = new RazorpayCtor({
          key: payload?.razorpay?.key_id,
          order_id: payload?.razorpay?.order_id,
          amount: payload?.razorpay?.amount_paise,
          currency: payload?.razorpay?.currency || "INR",
          name: "RxTrace",
          description: "Trial activation (₹1)",
          handler: () => resolve(),
          modal: { ondismiss: () => resolve() },
        });
        rzp.open();
      });

      // Webhook activates the trial. Refresh the page state after user returns.
      await refreshTrial();
      router.refresh();
    } catch (err: any) {
      setTrialActivateError(err?.message || "TRIAL_ACTIVATION_FAILED");
    } finally {
      setTrialActivating(false);
    }
  }

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyProfile, setCompanyProfile] = useState<{
    id: string;
    company_name?: string | null;
    phone?: string | null;
    address?: string | null;
    pan?: string | null;
    gst_number?: string | null;
    email?: string | null;
  } | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    company_name: "",
    phone: "",
    address: "",
    pan: "",
    gst_number: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function loadCompany() {
      setProfileLoading(true);
      setProfileError("");
      try {
        const supabase = supabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setProfileError("Unable to resolve company without authentication.");
          return;
        }

        const { data } = await supabase
          .from("companies")
          .select("id, company_name, phone, address, pan, gst_number:gst, email")
          .eq("user_id", user.id)
          .maybeSingle();

        if (data?.id) {
          setCompanyId(data.id);
          setCompanyProfile(data);
          setProfileForm({
            company_name: data.company_name ?? "",
            phone: data.phone ?? "",
            address: data.address ?? "",
            pan: data.pan ?? "",
            gst_number: data.gst_number ?? "",
          });
        } else {
          setProfileError("No company profile found for this account.");
        }
      } catch (err: any) {
        setProfileError(err?.message || "Failed to load company profile.");
      } finally {
        setProfileLoading(false);
      }
    }

    loadCompany();
  }, []);

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setSavingProfile(true);
    setProfileMessage(null);

    try {
      const res = await fetch("/api/company/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: profileForm.company_name.trim() || null,
          phone: profileForm.phone.trim() || null,
          address: profileForm.address.trim() || null,
          pan: profileForm.pan.trim() || null,
          gst_number: profileForm.gst_number.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save profile");
      }

      if (data.company) {
        setCompanyProfile((prev) =>
          prev
            ? { ...prev, ...data.company }
            : {
                id: data.company.id,
                company_name: data.company.company_name,
                phone: data.company.phone,
                address: data.company.address,
                pan: data.company.pan,
                gst_number: data.company.gst_number,
                email: data.company.email,
              }
        );
        setProfileForm({
          company_name: data.company.company_name ?? "",
          phone: data.company.phone ?? "",
          address: data.company.address ?? "",
          pan: data.company.pan ?? "",
          gst_number: data.company.gst_number ?? "",
        });
      }

      setProfileMessage({
        type: "success",
        text: "Profile saved successfully.",
      });
      setIsEditingProfile(false);
      setTimeout(() => setProfileMessage(null), 4000);
    } catch (err: any) {
      setProfileMessage({
        type: "error",
        text: err?.message || "Failed to save profile",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  if (trialLoading) {
    return (
      <div className="p-6 text-gray-500">
        Loading trial details...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-10 space-y-8">
      {/* Profile Panel */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Profile & Company</h2>
          {!isEditingProfile && (
            <button
              type="button"
              className="text-sm text-blue-600 hover:underline"
              onClick={() => {
                setIsEditingProfile(true);
                setProfileMessage(null);
              }}
            >
              Edit profile
            </button>
          )}
        </div>

        {profileLoading ? (
          <p className="text-sm text-gray-500">Loading company profile…</p>
        ) : profileError ? (
          <p className="text-sm text-red-500">{profileError}</p>
        ) : isEditingProfile ? (
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div>
              <p className="text-xs uppercase text-gray-500">Company Name</p>
              <input
                required
                value={profileForm.company_name}
                onChange={(e) =>
                  setProfileForm((s) => ({ ...s, company_name: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Contact Phone</p>
              <input
                required
                value={profileForm.phone}
                onChange={(e) =>
                  setProfileForm((s) => ({ ...s, phone: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Address</p>
              <textarea
                required
                value={profileForm.address}
                onChange={(e) =>
                  setProfileForm((s) => ({ ...s, address: e.target.value }))
                }
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase text-gray-500">PAN</p>
                <input
                  value={profileForm.pan}
                  onChange={(e) =>
                    setProfileForm((s) => ({ ...s, pan: e.target.value.toUpperCase() }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <p className="text-xs uppercase text-gray-500">GST</p>
                <input
                  value={profileForm.gst_number}
                  onChange={(e) =>
                    setProfileForm((s) => ({ ...s, gst_number: e.target.value.toUpperCase() }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {profileMessage && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  profileMessage.type === "success"
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {profileMessage.text}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingProfile ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                disabled={savingProfile}
                className="px-4 py-2 border border-gray-300 rounded-lg"
                onClick={() => {
                  setIsEditingProfile(false);
                  setProfileMessage(null);
                  if (companyProfile) {
                    setProfileForm({
                      company_name: companyProfile.company_name ?? "",
                      phone: companyProfile.phone ?? "",
                      address: companyProfile.address ?? "",
                      pan: companyProfile.pan ?? "",
                      gst_number: companyProfile.gst_number ?? "",
                    });
                  }
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase text-gray-500">Company</p>
              <p className="text-sm font-semibold text-gray-900">
                {companyProfile?.company_name || "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Email</p>
              <p className="text-sm text-gray-900">
                {companyProfile?.email || "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Phone</p>
              <p className="text-sm text-gray-900">
                {companyProfile?.phone || "Not provided"}
              </p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs uppercase text-gray-500">Address</p>
              <p className="text-sm text-gray-900">
                {companyProfile?.address || "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">PAN</p>
              <p className="text-sm text-gray-900">
                {companyProfile?.pan || "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">GST</p>
              <p className="text-sm text-gray-900">
                {companyProfile?.gst_number || "Not provided"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-gray-500 mt-2">
          Pilot configuration and system setup.
        </p>
      </div>

      {/* Trial Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-medium">Trial</h2>
            <p className="text-sm text-gray-500">
              Activate your 10-day trial by completing a ₹1 Razorpay payment. Trial starts only after webhook confirmation.
            </p>
          </div>
          <Badge
            className={`px-3 py-1 text-sm ${
              trialSummary?.trial_active
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {trialSummary?.trial_active
              ? "Active"
              : trialSummary?.trial_expires_at
              ? "Expired"
              : "Not started"}
          </Badge>
        </div>

        {trialError && (
          <div className="text-red-600 text-sm">{trialError}</div>
        )}
        {trialActivateError && (
          <div className="text-red-600 text-sm">{trialActivateError}</div>
        )}

        {trialSummary ? (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              {trialSummary.trial_active
                ? `${trialSummary.days_remaining} ${trialSummary.days_remaining === 1 ? "day" : "days"} remaining`
                : trialSummary.trial_expires_at
                ? "Trial has ended."
                : "Trial window not yet available."}
            </div>

            {!trialSummary.trial_active && !trialSummary.trial_expires_at && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={handleActivateTrial}
                  disabled={trialActivating}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {trialActivating ? "Opening payment..." : "Activate Trial (₹1)"}
                </Button>
                <span className="text-xs text-gray-500">
                  Payment is verified by webhook; activation may take a few seconds after payment.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {[
                { label: "Unit", key: "unit" },
                { label: "Box", key: "box" },
                { label: "Carton", key: "carton" },
                { label: "Pallet", key: "pallet" },
                { label: "Seats", key: "seat" },
                { label: "Plants", key: "plant" },
              ].map((metric) => {
                const usage = trialSummary.usage[metric.key as keyof typeof trialSummary.usage];
                const limit = trialSummary.limits[metric.key as keyof typeof trialSummary.limits];
                return (
                  <div
                    key={metric.key}
                    className="flex items-center justify-between border border-dashed border-gray-200 rounded-xl px-4 py-3"
                  >
                    <span className="text-gray-500">{metric.label}</span>
                    <span className="font-semibold text-gray-900">
                      {usage} / {limit}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Trial information is unavailable. Please refresh.</p>
        )}
      </div>

      {/* ERP Ingestion */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-xl font-medium">
          ERP Code Ingestion
        </h2>
        <p className="text-sm text-gray-600">
          Import ERP-generated serialization data via CSV upload.
        </p>

        <Link
          href="/dashboard/settings/erp-integration"
          className="inline-flex px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          Go to ERP Ingestion →
        </Link>
      </div>

      {/* Tax Settings */}
      {companyId && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <TaxSettingsPanel
            companyId={companyId}
            profileCompleted={true}
            initialPan={companyProfile?.pan ?? ""}
            initialGstNumber={companyProfile?.gst_number ?? ""}
            onSave={(pan, gst_number) => {
              setCompanyProfile((prev) =>
                prev
                  ? { ...prev, pan, gst_number }
                  : {
                      id: companyId,
                      company_name: "",
                      pan,
                      gst_number,
                      email: "",
                    }
              );
            }}
          />
        </div>
      )}

    </div>
  );
}
