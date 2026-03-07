'use client';

import { useState } from 'react';

type Props = {
  className?: string;
};

export default function BookDemoForm({ className }: Props) {
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Backend demo-request endpoint removed as part of legacy API cleanup.
      // Route users to email instead of storing in DB.
      const subject = encodeURIComponent('RxTrace Demo Request');
      const body = encodeURIComponent(
        `Name: ${name}\nCompany: ${companyName}\nEmail: ${email}\nPhone: ${phone}\nSource: landing`
      );
      window.location.href = `mailto:support@rxtrace.in?subject=${subject}&body=${body}`;

      setSuccess('your request submitted successfully team will contact you in 24 hours');
      setName('');
      setCompanyName('');
      setEmail('');
      setPhone('');
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
      setLoading(false);
    }
  }

  return (
    <form className={className || 'space-y-4'} onSubmit={onSubmit}>
      {error ? <div className="text-sm text-red-700">{error}</div> : null}
      {success ? <div className="text-sm text-green-700">{success}</div> : null}

      <input
        className="w-full border rounded-lg px-4 py-2"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        disabled={loading}
      />
      <input
        className="w-full border rounded-lg px-4 py-2"
        placeholder="Company Name"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        required
        disabled={loading}
      />
      <input
        className="w-full border rounded-lg px-4 py-2"
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={loading}
      />
      <input
        className="w-full border rounded-lg px-4 py-2"
        placeholder="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        disabled={loading}
      />

      <button
        type="submit"
        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60"
        disabled={loading}
      >
        {loading ? 'Submitting…' : 'Book Demo'}
      </button>
    </form>
  );
}
