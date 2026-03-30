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
      const subject = encodeURIComponent('RxTrace Demo Request');
      const body = encodeURIComponent(
        `Name: ${name}\nCompany: ${companyName}\nEmail: ${email}\nPhone: ${phone}\nSource: landing`
      );
      window.location.href = `mailto:support@rxtrace.in?subject=${subject}&body=${body}`;

      setSuccess('Your request is ready. Our team will contact you shortly.');
      setName('');
      setCompanyName('');
      setEmail('');
      setPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={className || 'space-y-4'} onSubmit={onSubmit}>
      {error ? <div className="text-sm text-[#B91C1C]">{error}</div> : null}
      {success ? <div className="text-sm text-[#15803D]">{success}</div> : null}

      <input
        className="w-full rounded-xl border border-[#C8D9DA] bg-[#FCFEFE] px-4 py-3 text-sm text-[#0F172A] outline-none transition placeholder:text-[#7B8E90] focus:border-[#0F5D5E] focus:ring-2 focus:ring-[#0F5D5E]/10"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        disabled={loading}
      />
      <input
        className="w-full rounded-xl border border-[#C8D9DA] bg-[#FCFEFE] px-4 py-3 text-sm text-[#0F172A] outline-none transition placeholder:text-[#7B8E90] focus:border-[#0F5D5E] focus:ring-2 focus:ring-[#0F5D5E]/10"
        placeholder="Company Name"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        required
        disabled={loading}
      />
      <input
        className="w-full rounded-xl border border-[#C8D9DA] bg-[#FCFEFE] px-4 py-3 text-sm text-[#0F172A] outline-none transition placeholder:text-[#7B8E90] focus:border-[#0F5D5E] focus:ring-2 focus:ring-[#0F5D5E]/10"
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={loading}
      />
      <input
        className="w-full rounded-xl border border-[#C8D9DA] bg-[#FCFEFE] px-4 py-3 text-sm text-[#0F172A] outline-none transition placeholder:text-[#7B8E90] focus:border-[#0F5D5E] focus:ring-2 focus:ring-[#0F5D5E]/10"
        placeholder="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        disabled={loading}
      />

      <button
        type="submit"
        className="w-full rounded-xl bg-[#0F5D5E] py-3 text-sm font-semibold text-white transition hover:bg-[#083B3C] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading}
      >
        {loading ? 'Submitting...' : 'Book Demo'}
      </button>
    </form>
  );
}
