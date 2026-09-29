"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSubscriptionSummary } from "@/lib/hooks/useSubscriptionSummary";
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

function formatDate(value: string | null | undefined) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function SettingsPage() {
  const router = useRouter();
  const {
    data: entitlementSummary,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
  } = useSubscriptionSummary({
    view: "settings",
  });
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
    entitlementSummary?.subscriptionStatus?.source === "subscription" &&
    entitlementSummary?.subscriptionStatus?.status === "active";
  const generationEnabled = Boolean(
    hasActiveSubscription && entitlementSummary?.decisions?.generation && !entitlementSummary.decisions.generation.blocked
  );
  const scheduledToEnd =
    hasActiveSubscription &&
    entitlementSummary?.subscriptionStatus?.rawStatus === "cancelled" &&
    entitlementSummary?.subscription?.cancel_at_period_end;
  const subscriptionInactive = entitlementSummary?.subscriptionStatus?.source === "subscription" && !hasActiveSubscription;
  const inactiveSubscriptionStatus = subscriptionInactive
    ? entitlementSummary?.subscriptionStatus?.status ?? entitlementSummary?.subscription?.status ?? "expired"
    : null;
  const planRecoveryLabel =
    inactiveSubscriptionStatus === "cancelled"
      ? "Reactivate Plan"
      : inactiveSubscriptionStatus === "expired"
        ? "Renew Plan"
        : "Activate Plan";
  const accessBadgeLabel = hasActiveSubscription
    ? scheduledToEnd
      ? "Active Until End Date"
      : "Subscription Activated"
    : subscriptionInactive
      ? inactiveSubscriptionStatus === "cancelled"
        ? "Plan Cancelled"
        : inactiveSubscriptionStatus === "pending"
          ? "Payment Pending"
          : "Plan Expired"
      : "No Active Subscription";

  const accessMessage = useMemo(
    () =>
      scheduledToEnd
        ? `Subscription remains active until ${formatDate(entitlementSummary?.subscription?.current_period_end)}.`
        : hasActiveSubscription
          ? `Subscription activated: ${entitlementSummary?.subscription?.plan_name || "Subscription"}`
          : subscriptionInactive
            ? inactiveSubscriptionStatus === "cancelled"
              ? "Plan cancelled. Reactivate or choose a new plan to restore paid access."
              : inactiveSubscriptionStatus === "pending"
                ? "Payment is pending. Complete checkout or choose a plan to activate access."
                : "Plan expired. Renew or upgrade to restore paid access."
            : "Choose a plan to activate access.",
    [
      entitlementSummary?.subscription?.current_period_end,
      entitlementSummary?.subscription?.plan_name,
      hasActiveSubscription,
      inactiveSubscriptionStatus,
      scheduledToEnd,
      subscriptionInactive,
    ]
  );

  const profileLoading = summaryLoading && !companyProfile;

  return (
    <div className="max-w-5xl mx-auto px-8 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-gray-500 mt-2">Pilot configuration and system setup.</p>
      </div>

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
            <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p>{accessMessage}</p>
              {!hasActiveSubscription ? (
                <Button asChild size="sm" className="w-fit bg-blue-600 hover:bg-blue-700">
                  <Link href="/dashboard/subscription">
                    {subscriptionInactive ? planRecoveryLabel : "Upgrade Plan"}
                  </Link>
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      {!!summaryError && <p className="text-sm text-red-600">{summaryError}</p>}

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
            <Badge className="bg-green-600 text-white">{accessBadgeLabel}</Badge>
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

          <div className="rounded-xl border border-gray-200 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-gray-900">Quota for current period</h3>
              <p className="text-xs text-gray-500">
                {formatDate(entitlementSummary.period?.start)} – {formatDate(entitlementSummary.period?.end)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="py-2">Resource</th><th className="py-2">Opening</th><th className="py-2">Used</th><th className="py-2">Remaining / Closing</th></tr>
                </thead>
                <tbody>
                  {(entitlementSummary.quota_table || []).map((row) => (
                    <tr key={row.metric} className="border-t border-gray-100">
                      <td className="py-2">{row.metric === "pallet" ? "Pallet SSCC" : `${row.metric[0].toUpperCase()}${row.metric.slice(1)} QR`}</td>
                      <td className="py-2">{row.opening.toLocaleString("en-IN")}</td>
                      <td className="py-2">{row.used.toLocaleString("en-IN")}</td>
                      <td className="py-2">{row.remaining.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            {entitlementSummary.capacity_table?.map((row) => (
              <div key={row.metric} className="rounded-xl border border-dashed border-gray-200 px-4 py-3">
                <p className="text-gray-500 capitalize">{row.metric}s</p>
                <p className="font-semibold text-gray-900">{row.opening} capacity · {row.used} active</p>
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
      ) : null}

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
