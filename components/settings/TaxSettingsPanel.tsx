'use client';

import { useState, useEffect } from 'react';

type TaxSettingsPanelProps = {
  companyId: string;
  profileCompleted: boolean;
  initialPan?: string;
  initialGstNumber?: string;
  onSave?: (pan: string | null, gstNumber: string | null) => void;
};

/**
 * TaxSettingsPanel - Billing Details (Optional)
 * 
 * GST and PAN are used ONLY for billing and invoices.
 * They are NOT required for code generation or printing.
 * This panel always renders in Settings and never blocks other features.
 */
export default function TaxSettingsPanel({
  companyId,
  profileCompleted,
  initialPan = '',
  initialGstNumber = '',
  onSave,
}: TaxSettingsPanelProps) {
  const [pan, setPan] = useState(initialPan);
  const [gstNumber, setGstNumber] = useState(initialGstNumber);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setPan(initialPan);
    setGstNumber(initialGstNumber);
  }, [initialPan, initialGstNumber]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/company/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pan: pan.trim().toUpperCase() || null,
          gst_number: gstNumber.trim().toUpperCase() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save billing details');

      setMessage({ type: 'success', text: 'Billing details saved successfully' });
      setTimeout(() => setMessage(null), 3000);
      onSave?.(pan.trim().toUpperCase() || null, gstNumber.trim().toUpperCase() || null);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save billing details' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="p-8 space-y-6">
        {/* Section Header with UX Label */}
        <div>
          <h2 className="text-xl font-medium">Billing Details (Optional)</h2>
          <p className="text-sm text-gray-500 mt-1">
            GST and PAN are used only for billing and invoices. They are not required for code generation or printing.
          </p>
        </div>

        {/* Info Box */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> These fields are optional. You can generate, export, and print codes without providing GST or PAN information.
          </p>
        </div>

        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* PAN Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              PAN Number (Optional)
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="ABCDE1234F"
              maxLength={10}
            />
            <p className="text-xs text-gray-500 mt-1">Used for billing invoices and tax reports</p>
          </div>

          {/* GST Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              GST Number (Optional)
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
              placeholder="22ABCDE1234F1Z5"
              maxLength={15}
            />
            <p className="text-xs text-gray-500 mt-1">Used for GST invoices and compliance reports</p>
          </div>

          {/* Message */}
          {message && (
            <div className={`md:col-span-2 p-3 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          {/* Submit Button */}
          <div className="md:col-span-2 flex justify-end pt-4 border-t">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving ? 'Saving...' : 'Save Billing Details'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
