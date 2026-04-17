"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSubscriptionSummary } from "@/lib/hooks/useSubscriptionSummary";
import { useQueryParams } from "@/lib/hooks/useQueryParams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TaxSettingsPanel = dynamic(() => import("@/components/settings/TaxSettingsPanel"), {
  ssr: false,
  loading: () => <div className="h-56 animate-pulse rounded-2xl border border-gray-200 bg-white" />,
});

type CompanyProfile = {
  id: string;
  company_name?: string | null;
  phone?: string | null;
  address?: string | null;
  pan?: string | null;
  gst_number?: string | null;
};

function SkeletonRow() {
  return <div className="h-4 w-full animate-pulse rounded bg-gray-100" />;
}

export default function SettingsPage() {
  const router = useRouter();
  const query = useQueryParams();
  const {
    data: entitlementSummary,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
  } = useSubscriptionSummary({
    view: "settings",
  });
  const [trialActivating, setTrialActivating] = useState(false);
  const [trialActivateError, setTrialActivateError] = useState<string | null>(null);
  const [trialCancelling, setTrialCancelling] = useState(false);
  const [trialCancelError, setTrialCancelError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
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
  const showTrialOnboarding = query.get("onboarding") === "trial_activation";

  useEffect(() => {
    const profile = entitlementSummary?.company_profile;
    if (!profile?.id) {
      if (!summaryLoading && !summaryError) {
        setProfileError("No company profile found for this account.");
      }
      return;
    }

    setProfileError("");
    setCompanyId(profile.id);
    setCompanyProfile(profile);
    setProfileForm({
      company_name: profile.company_name ?? "",
      phone: profile.phone ?? "",
      address: profile.address ?? "",
      pan: profile.pan ?? "",
      gst_number: profile.gst_number ?? "",
    });
  }, [entitlementSummary, summaryError, summaryLoading]);

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
          description: "Trial activation (\u20b91)",
          handler: () => resolve(),
          modal: { ondismiss: () => resolve() },
        });
        rzp.open();
      });

      await refreshSummary({ force: true });
      router.refresh();
    } catch (err: any) {
      setTrialActivateError(err?.message || "TRIAL_ACTIVATION_FAILED");
    } finally {
      setTrialActivating(false);
    }
  }

  async function handleCancelTrial() {
    setTrialCancelError(null);
    setTrialCancelling(true);
    try {
      const res = await fetch("/api/company/trial/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "TRIAL_CANCEL_FAILED");
      }

      await refreshSummary({ force: true });
      router.refresh();
    } catch (err: any) {
      setTrialCancelError(err?.message || "TRIAL_CANCEL_FAILED");
    } finally {
      setTrialCancelling(false);
    }
  }

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
      refreshSummary({ force: true }).catch(() => undefined);
    } catch (err: any) {
      setProfileMessage({
        type: "error",
        text: err?.message || "Failed to save profile",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  const hasActiveSubscription =
    entitlementSummary?.subscriptionStatus?.source === "subscription" ||
    entitlementSummary?.subscription?.status === "active";
  const subscriptionCancelled = entitlementSummary?.subscriptionStatus?.status === "cancelled";
  const trialActive = Boolean(
    entitlementSummary?.trial?.active ?? entitlementSummary?.entitlement?.trial_active
  ) && !hasActiveSubscription;
  const trialWasAlreadyUsed = Boolean(entitlementSummary?.trial?.expires_at);
  const generationEnabled = !subscriptionCancelled && (hasActiveSubscription || trialActive);
  const trialBadgeLabel = trialActive
    ? "Trial Activated"
    : trialWasAlreadyUsed
      ? "Trial Expired"
      : "Trial Inactive";

  const accessMessage = useMemo(
    () =>
      subscriptionCancelled
        ? "Subscription cancelled. Renew or subscribe to continue."
        : hasActiveSubscription
          ? `Subscription activated: ${entitlementSummary?.subscription?.plan_name || "Subscription"}`
        : trialActive
            ? "Trial activated (limits apply)"
            : "Trial expired. Upgrade to continue",
    [entitlementSummary?.subscription?.plan_name, hasActiveSubscription, subscriptionCancelled, trialActive]
  );

  const profileLoading = summaryLoading && !companyProfile;

  return (
    <div className="max-w-5xl mx-auto px-8 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-gray-500 mt-2">Pilot configuration and system setup.</p>
      </div>

      {showTrialOnboarding ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Account created and company setup is complete. Activate the trial below to finish onboarding.
        </div>
      ) : null}

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Profile & Company</h2>
          {!isEditingProfile && !profileLoading && (
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
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
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

      <div
        className={`rounded-2xl border p-4 text-sm ${
          generationEnabled
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        {summaryLoading && !entitlementSummary ? (
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : (
          <>
            <p className="font-medium">Generation Eligibility</p>
            <p className="mt-1">{accessMessage}</p>
          </>
        )}
      </div>

      {!!summaryError && <p className="text-sm text-red-600">{summaryError}</p>}
      {trialActivateError && <p className="text-sm text-red-600">{trialActivateError}</p>}
      {trialCancelError && <p className="text-sm text-red-600">{trialCancelError}</p>}

      {summaryLoading && !entitlementSummary ? (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-3">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : hasActiveSubscription && entitlementSummary ? (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-medium">Subscription</h2>
              <p className="text-sm text-gray-500">Subscription is activated. Entitlement is now controlled by your plan and add-ons.</p>
            </div>
            <Badge className="bg-green-600 text-white">Subscription Activated</Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            <div>
              <p className="text-gray-500">Plan</p>
              <p className="font-semibold text-gray-900">{entitlementSummary.subscription?.plan_name || "Active plan"}</p>
            </div>
            <div>
              <p className="text-gray-500">Billing Cycle</p>
              <p className="font-semibold text-gray-900">{entitlementSummary.subscription?.billing_cycle || "-"}</p>
            </div>
            <div>
              <p className="text-gray-500">Renewal</p>
              <p className="font-semibold text-gray-900">
                {entitlementSummary.subscription?.renewal_date
                  ? new Date(entitlementSummary.subscription.renewal_date).toLocaleDateString()
                  : "-"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            {entitlementSummary.capacity_table?.map((row) => (
              <div key={row.metric} className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <p className="text-gray-500 capitalize">{row.metric}s</p>
                <p className="font-semibold text-gray-900">
                  {row.consumed} / {row.allocated}
                </p>
                <p className="text-xs text-gray-500">
                  Plan {row.subscription_allocated}, Add-ons {row.addon_allocated}, Remaining {row.remaining}
                </p>
              </div>
            ))}
          </div>

          {(entitlementSummary.capacity_addons || []).length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Active Capacity Add-ons</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {(entitlementSummary.capacity_addons || []).map((addon) => (
                  <div key={addon.addon_id} className="rounded border px-3 py-2 text-sm">
                    <p className="font-medium text-gray-900">{addon.name || addon.addon_id}</p>
                    <p className="text-xs text-gray-500">
                      {addon.entitlement_key}: +{addon.quantity}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-medium">Trial</h2>
              <p className="text-sm text-gray-500">
                Activate your 10-day trial by completing a INR 1 Razorpay payment. Trial starts only after webhook confirmation.
              </p>
            </div>
            <Badge className={`px-3 py-1 text-sm ${trialActive ? "bg-green-600 text-white" : "bg-red-100 text-red-700"}`}>
              {trialBadgeLabel}
            </Badge>
          </div>

          {trialActive && entitlementSummary ? (
            <>
              <div className="text-sm text-gray-600">
                {Math.max(0, Number(entitlementSummary?.trial?.days_remaining || 0))} day(s) remaining
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Unit", key: "unit" },
                  { label: "Box", key: "box" },
                  { label: "Carton", key: "carton" },
                  { label: "Pallet", key: "pallet" },
                  { label: "Seats", key: "seat" },
                  { label: "Plants", key: "plant" },
                  { label: "Handsets", key: "handset" },
                ].map((metric) => {
                  const usage = entitlementSummary.entitlement?.usage?.[metric.key] ?? 0;
                  const limit = entitlementSummary.entitlement?.limits?.[metric.key] ?? 0;
                  const remaining = entitlementSummary.entitlement?.remaining?.[metric.key] ?? 0;
                  return (
                    <div
                      key={metric.key}
                      className="flex items-center justify-between border border-dashed border-gray-200 rounded-xl px-4 py-3"
                    >
                      <span className="text-gray-500">{metric.label}</span>
                      <span className="font-semibold text-gray-900">
                        {usage} / {limit} ({remaining} left)
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleCancelTrial}
                  disabled={trialCancelling}
                >
                  {trialCancelling ? "Cancelling..." : "Cancel Trial"}
                </Button>
                <span className="text-xs text-gray-500">
                  Cancelling removes trial quotas and ends access immediately.
                </span>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                {subscriptionCancelled
                  ? "Subscription cancelled."
                  : trialWasAlreadyUsed
                    ? "Trial expired or cancelled. Reactivation is not available."
                    : "Trial inactive."}
              </p>
              <div className="flex items-center gap-3">
                {!subscriptionCancelled && !trialWasAlreadyUsed && (
                  <Button
                    type="button"
                    onClick={handleActivateTrial}
                    disabled={trialActivating}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {trialActivating ? "Opening payment..." : "Activate Trial (INR 1)"}
                  </Button>
                )}
                <Button asChild className="bg-blue-600 hover:bg-blue-700">
                  <Link href="/dashboard/subscription">
                    {subscriptionCancelled ? "Renew Plan" : "Upgrade Plan"}
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-xl font-medium">ERP Code Ingestion</h2>
        <p className="text-sm text-gray-600">
          Import ERP-generated serialization data via CSV upload.
        </p>

        <Link
          href="/dashboard/settings/erp-integration"
          className="inline-flex px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          Go to ERP Ingestion
        </Link>
      </div>

      {companyId ? (
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
                    }
              );
            }}
          />
        </div>
      ) : (
        <div className="h-56 animate-pulse rounded-2xl border border-gray-200 bg-white" />
      )}
    </div>
  );
}
