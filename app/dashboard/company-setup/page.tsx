'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Check, CheckCircle, ShieldCheck } from 'lucide-react';
import { createOrUpdateCompanyProfile } from './actions';
import { industries, IndustryOption, isIndustryOption } from '@/lib/companies/industry';
import { useQueryParams } from '@/lib/hooks/useQueryParams';

// Type definitions
type LegalStructure = 'proprietorship' | 'partnership' | 'llp' | 'pvt_ltd';
type BusinessType = 'manufacturer' | 'distributor' | 'brand_owner' | 'wholesaler' | 'exporter' | 'importer' | 'cf_agent';
type Industry = IndustryOption;
type BusinessCategory = Industry;

function CompanySetupContent() {
  const router = useRouter();
  const query = useQueryParams();
  const reasonCompleteProfile = query.get('reason') === 'complete_profile';
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState(false);

  // Form state - ALL required fields
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [industry, setIndustry] = useState<Industry | ''>('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [legalStructure, setLegalStructure] = useState<LegalStructure | ''>('');
  const [businessCategory, setBusinessCategory] = useState<BusinessCategory | ''>('');
  const [gstNumber, setGstNumber] = useState('');
  const [pan, setPan] = useState('');

  useEffect(() => {
    const loadingTimeout = window.setTimeout(() => {
      setError('Company information is taking too long to load. Check your connection and refresh the page.');
      setLoading(false);
    }, 15000);

    (async () => {
      try {
        const supabase = supabaseClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/login');
          return;
        }

        const fallbackContactPerson = String(
          user.user_metadata?.full_name || user.email || ''
        ).trim();
        if (fallbackContactPerson) {
          setContactPerson((current) => current || fallbackContactPerson);
        }

        // Check if company exists (always allow editing, even if profile_completed === true)
        const { data: existingCompany, error: companyError } = await supabase
          .from('companies')
          .select('id, company_name, contact_person, phone, address, industry, business_type, firm_type, business_category, gst_number, pan, profile_completed')
          .eq('user_id', user.id)
          .maybeSingle();
        if (companyError) throw companyError;

        // Load existing data if available
        if (existingCompany?.id) {
          setCompanyName(existingCompany.company_name || '');
          setContactPerson(existingCompany.contact_person || '');
          setPhone(existingCompany.phone || '');
          setAddress(existingCompany.address || '');
          if (existingCompany.industry && isIndustryOption(existingCompany.industry)) {
            setIndustry(existingCompany.industry);
          }
          if (existingCompany.business_type) {
            setBusinessType(existingCompany.business_type as BusinessType);
          }
          if (existingCompany.firm_type) {
            setLegalStructure(existingCompany.firm_type as LegalStructure);
          }
          if (existingCompany.business_category && isIndustryOption(existingCompany.business_category)) {
            setBusinessCategory(existingCompany.business_category);
          }
          if (existingCompany.gst_number) {
            setGstNumber(existingCompany.gst_number);
          }
          if (existingCompany.pan) {
            setPan(existingCompany.pan);
          }
        }
        setError('');

      } catch (loadError) {
        console.error('Failed to load company information', loadError);
        setError('Unable to load company information. Please refresh and try again.');
      } finally {
        window.clearTimeout(loadingTimeout);
        setLoading(false);
      }
    })();

    return () => window.clearTimeout(loadingTimeout);
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess(false);

    // Validation - ALL fields are required
    if (!companyName.trim()) {
      setError('Company Name is required');
      setSubmitting(false);
      return;
    }
    if (!contactPerson.trim()) {
      setError('Contact Person is required');
      setSubmitting(false);
      return;
    }
    if (!phone.trim()) {
      setError('Phone Number is required');
      setSubmitting(false);
      return;
    }
    if (!address.trim()) {
      setError('Address is required');
      setSubmitting(false);
      return;
    }
    if (!industry) {
      setError('Industry is required');
      setSubmitting(false);
      return;
    }
    if (!businessType) {
      setError('Type of Business is required');
      setSubmitting(false);
      return;
    }

    // Call server action (backend-first execution path)
    const result = await createOrUpdateCompanyProfile({
      company_name: companyName.trim(),
      name: companyName.trim(),
      contact_person: contactPerson.trim(),
      phone: phone.trim(),
      address: address.trim(),
      industry,
      business_type: businessType,
      firm_type: legalStructure || undefined,
      business_category: businessCategory || undefined,
      gst_number: gstNumber.trim() || undefined,
      pan: pan.trim() || undefined,
      created_at: new Date().toISOString(),
    });

    if (!result.success) {
      setError(result.error + (result.details ? `: ${result.details}` : ''));
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => {
      router.push('/dashboard/subscription?onboarding=complete');
    }, 1500);
  };

  // Clear errors when fields become valid
  const handleCompanyNameChange = (value: string) => {
    setCompanyName(value);
    if (error && error.includes('Company Name')) {
      setError('');
    }
  };

  const handlePhoneChange = (value: string) => {
    setPhone(value);
    if (error && error.includes('Phone')) {
      setError('');
    }
  };

  const handleContactPersonChange = (value: string) => {
    setContactPerson(value);
    if (error && error.includes('Contact Person')) {
      setError('');
    }
  };

  const handleAddressChange = (value: string) => {
    setAddress(value);
    if (error && error.includes('Address')) {
      setError('');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6">
        <div className="w-full max-w-[640px] rounded-2xl border border-slate-100 bg-white p-8 text-sm text-slate-500 shadow-[0_24px_70px_rgba(15,76,129,0.14)]">
          Loading company information...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-white px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-[640px]">
        <div className="mb-6 flex items-center justify-center gap-3 sm:mb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0F4C81] text-white shadow-lg">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0F4C81]">RxTrace</p>
            <p className="text-xs font-bold tracking-[0.26em] text-[#1E88E5]">BE ORIGINAL</p>
          </div>
        </div>

        <Card className="rounded-2xl border border-slate-100 bg-white shadow-[0_24px_70px_rgba(15,76,129,0.14)]">
          <CardHeader className="space-y-0 px-5 pb-4 pt-6 text-center sm:px-8 sm:pt-8">
            <div className="mb-7">
              <p className="mb-3 text-sm font-bold text-[#0F4C81]">Step 2 of 2</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-[#0F4C81]" />
                  <p className="flex items-center justify-center gap-1 text-xs font-semibold text-[#0F4C81]"><Check className="h-3.5 w-3.5" aria-hidden="true" />Account</p>
                </div>
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-[#0F4C81]" />
                  <p className="text-center text-xs font-semibold text-[#0F4C81]">Company</p>
                </div>
              </div>
            </div>
            <CardTitle className="text-3xl font-bold tracking-normal text-slate-950">Company Setup</CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-500">
              Complete your company profile to continue
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-6 sm:px-8 sm:pb-8">
            {reasonCompleteProfile && (
              <Alert className="mb-5 rounded-[10px] border-amber-200 bg-amber-50 text-amber-900">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription>Please complete your company profile to access the dashboard.</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mb-5 rounded-[10px]">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert className="mb-5 rounded-[10px] border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Company setup completed successfully. Redirecting to your subscription...
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <p className="text-xs font-medium text-slate-500">Required fields are marked with *</p>
              <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-[#0F4C81]">Business Information</h3>
            {/* 1. Company Name */}
            <div>
                <Label htmlFor="companyName" className="text-sm font-semibold text-slate-800">
                Company Name *
              </Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => handleCompanyNameChange(e.target.value)}
                placeholder="Enter your company name"
                required
                disabled={submitting}
                className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus-visible:border-[#1E88E5] focus-visible:ring-[#1E88E5]/20"
              />
            </div>

            {/* 2. Contact Person */}
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-[#0F4C81]">Contact Information</h3>
            <div>
                <Label htmlFor="contactPerson" className="text-sm font-semibold text-slate-800">
                Contact Person *
              </Label>
              <Input
                id="contactPerson"
                value={contactPerson}
                onChange={(e) => handleContactPersonChange(e.target.value)}
                placeholder="Full name of responsible person"
                required
                disabled={submitting}
                className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus-visible:border-[#1E88E5] focus-visible:ring-[#1E88E5]/20"
              />
            </div>

            {/* 3. Phone Number */}
            <div>
                <Label htmlFor="phone" className="text-sm font-semibold text-slate-800">
                Phone Number *
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="Enter contact phone number"
                required
                disabled={submitting}
                className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus-visible:border-[#1E88E5] focus-visible:ring-[#1E88E5]/20"
              />
            </div>

            {/* 4. Address */}
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-[#0F4C81]">Address</h3>
            <div>
              <Label htmlFor="address" className="text-sm font-semibold text-slate-800">
                Address *
              </Label>
              <textarea
                id="address"
                value={address}
                onChange={(e) => handleAddressChange(e.target.value)}
                placeholder="Enter registered company address"
                required
                rows={3}
                disabled={submitting}
                className="mt-1.5 w-full rounded-[10px] border border-slate-200 px-3 py-3 text-[15px] text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15"
              />
            </div>

            {/* 5. Industry */}
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-[#0F4C81]">Business Category</h3>
            <div>
              <Label htmlFor="industry" className="text-sm font-semibold text-slate-800">
                Industry *
              </Label>
              <Select 
                value={industry} 
                onValueChange={(v) => {
                  setIndustry(v as Industry);
                  if (error && error.includes('Industry')) {
                    setError('');
                  }
                }}
                disabled={submitting}
              >
                <SelectTrigger id="industry" className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus:ring-[#1E88E5]/20">
                  <SelectValue placeholder="Select your industry" />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 6. Business Type */}
            <div>
              <Label htmlFor="businessType" className="text-sm font-semibold text-slate-800">
                Type of Business *
              </Label>
              <Select 
                value={businessType} 
                onValueChange={(v) => {
                  setBusinessType(v as BusinessType);
                  if (error && error.includes('Business')) {
                    setError('');
                  }
                }}
                disabled={submitting}
              >
                <SelectTrigger id="businessType" className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus:ring-[#1E88E5]/20">
                  <SelectValue placeholder="Manufacturer / Distributor / Brand Owner / Wholesaler" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manufacturer">Manufacturer</SelectItem>
                  <SelectItem value="distributor">Distributor</SelectItem>
                  <SelectItem value="brand_owner">Brand Owner</SelectItem>
                  <SelectItem value="wholesaler">Wholesaler</SelectItem>
                  <SelectItem value="exporter">Exporter</SelectItem>
                  <SelectItem value="importer">Importer</SelectItem>
                  <SelectItem value="cf_agent">C&F Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 7. Firm Type (Optional) */}
            <div>
              <Label htmlFor="legalStructure" className="text-sm font-semibold text-slate-800">
                Firm Type (Optional)
              </Label>
              <Select 
                value={legalStructure} 
                onValueChange={(v) => setLegalStructure(v as LegalStructure)}
                disabled={submitting}
              >
                <SelectTrigger id="legalStructure" className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus:ring-[#1E88E5]/20">
                  <SelectValue placeholder="Private Limited / LLP / Proprietorship / Partnership" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pvt_ltd">Private Limited</SelectItem>
                  <SelectItem value="llp">LLP</SelectItem>
                  <SelectItem value="proprietorship">Proprietorship</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 8. Business Category (Optional) */}
            <div>
              <Label htmlFor="businessCategory" className="text-sm font-semibold text-slate-800">
                Business Category (Optional)
              </Label>
              <Select
                value={businessCategory}
                onValueChange={(v) => setBusinessCategory(v as BusinessCategory)}
                disabled={submitting}
              >
                <SelectTrigger id="businessCategory" className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus:ring-[#1E88E5]/20">
                  <SelectValue placeholder="Select business category" />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 9. GST Number (Optional) */}
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-[#0F4C81]">Optional Information</h3>
            <div>
              <Label htmlFor="gstNumber" className="text-sm font-semibold text-slate-800">
                GST Number (Optional)
              </Label>
              <Input
                id="gstNumber"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                placeholder="Enter GST number (optional)"
                disabled={submitting}
                className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus-visible:border-[#1E88E5] focus-visible:ring-[#1E88E5]/20"
              />
            </div>

            {/* 10. PAN (Optional) */}
            <div>
              <Label htmlFor="pan" className="text-sm font-semibold text-slate-800">
                PAN (Optional)
              </Label>
              <Input
                id="pan"
                value={pan}
                onChange={(e) => setPan(e.target.value)}
                placeholder="Enter PAN (optional)"
                disabled={submitting}
                className="mt-1.5 h-12 rounded-[10px] border-slate-200 shadow-sm focus-visible:border-[#1E88E5] focus-visible:ring-[#1E88E5]/20"
              />
            </div>

            {/* Actions */}
            <div className="border-t border-slate-200 pt-5">
              <Button
                type="submit"
                disabled={submitting || !companyName.trim() || !contactPerson.trim() || !phone.trim() || !address.trim() || !industry || !businessType}
                className="h-12 w-full rounded-[10px] bg-[#0F4C81] text-sm font-bold text-white shadow-lg shadow-[#0F4C81]/20 transition hover:bg-[#0A3B63] focus-visible:ring-4 focus-visible:ring-[#1E88E5]/20"
              >
                {submitting ? 'Saving...' : 'Continue to Subscription'}
              </Button>
              <p className="mt-3 text-center text-sm text-slate-500">You can upgrade your subscription after setup.</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard/subscription')}
                disabled={submitting}
                className="mt-4 h-10 w-full rounded-[10px] border-slate-300 font-semibold text-slate-700"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function CompanySetupPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading...</div>}>
      <CompanySetupContent />
    </Suspense>
  );
}
