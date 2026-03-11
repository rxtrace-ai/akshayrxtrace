"use client";

import { useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type TraceCounts = {
  units_in_box?: number;
  boxes_in_carton?: number;
  cartons_in_pallet?: number;
  units_in_carton?: number;
  boxes_in_pallet?: number;
  units_in_pallet?: number;
};

type SearchResponse = {
  type: "UNIT" | "BOX" | "CARTON" | "PALLET";
  serial?: string;
  box_sscc?: string;
  carton_sscc?: string;
  pallet_sscc?: string;
  counts?: TraceCounts;
};

function HierarchyCard({
  title,
  identifier,
  highlight,
}: {
  title: string;
  identifier?: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-white border rounded-xl shadow-sm p-5 w-full max-w-md ${
        highlight ? "border-blue-400" : ""
      }`}
    >
      <div className="text-sm font-semibold text-gray-600">
        {title}
        {highlight ? (
          <span className="ml-2 text-xs text-blue-600">MATCH</span>
        ) : null}
      </div>

      <div className="font-mono text-lg mt-2 break-all">
        {identifier || "-"}
      </div>
    </div>
  );
}

export default function Page() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chain = useMemo(() => {
    if (!result) return null;
    return [
      { key: "UNIT", label: "Unit", value: result.serial ?? null },
      { key: "BOX", label: "Box", value: result.box_sscc ?? null },
      { key: "CARTON", label: "Carton", value: result.carton_sscc ?? null },
      { key: "PALLET", label: "Pallet", value: result.pallet_sscc ?? null },
    ].filter((item) => item.value);
  }, [result]);

  const countEntries = useMemo(() => {
    if (!result?.counts) return [];
    return Object.entries(result.counts).map(([key, value]) => ({
      key,
      value,
    }));
  }, [result]);

  async function handleSearch() {
    const trimmed = code.trim();

    if (!trimmed) {
      setError("Please enter or scan a code.");
      return;
    }

    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const supabase = supabaseClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("User not authenticated");

      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!company?.id) throw new Error("Company not found");

      const res = await fetch(
        `/api/search?code=${encodeURIComponent(
          trimmed
        )}&company_id=${encodeURIComponent(company.id)}`
      );

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "Search failed");

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSearch();
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-8">
      {/* Header */}

      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          Supply Chain Traceability
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          Scan or enter Serial, SSCC, GS1 payload, or verification URL
        </p>
      </div>

      {/* Search Box */}

      <div className="bg-white border rounded-xl shadow-sm p-6 flex gap-4">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Scan or enter Serial / SSCC"
          className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <button
          onClick={handleSearch}
          disabled={loading}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Error */}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* Result */}

      {result && (
        <div className="flex flex-col items-center space-y-4">
          {chain?.map((item, index) => (
            <div key={item.key} className="flex flex-col items-center space-y-4">
              {index > 0 && <div className="text-gray-400">v</div>}
              <HierarchyCard
                title={item.label}
                identifier={item.value}
                highlight={result.type === item.key}
              />
            </div>
          ))}

          {countEntries.length > 0 && (
            <div className="bg-white border rounded-xl shadow-sm p-5 w-full max-w-md">
              <div className="text-sm font-semibold text-gray-600">
                Aggregated Counts
              </div>
              <div className="text-sm text-gray-700 mt-2 space-y-1">
                {countEntries.map((entry) => (
                  <div key={entry.key} className="flex justify-between">
                    <span className="font-mono">{entry.key}</span>
                    <span>{entry.value ?? "-"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
