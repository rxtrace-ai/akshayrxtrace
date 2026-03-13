'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { createOrUpdateCompanyProfile } from './actions';
import { industries, IndustryOption, isIndustryOption } from '@/lib/companies/industry';

// Type definitions
type LegalStructure = 'proprietorship' | 'partnership' | 'llp' | 'pvt_ltd';
type BusinessType = 'manufacturer' | 'distributor' | 'brand_owner' | 'wholesaler' | 'exporter' | 'importer' | 'cf_agent';
type Industry = IndustryOption;
type BusinessCategory = Industry;

function CompanySetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reasonCompleteProfile = searchParams.get('reason') === 'complete_profile';
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
    (async () => {
      const supabase = supabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth/signin');
        return;
      }

      // Check if company exists (always allow editing, even if profile_completed === true)
      const { data: existingCompany } = await supabase
        .from('companies')
        .select('id, company_name, contact_person, phone, address, industry, business_type, firm_type, business_category, gst_number, pan, profile_completed')
        .eq('user_id', user.id)
        .maybeSingle();

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

      setLoading(false);
    })();
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
      router.push('/dashboard');
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
      <div className="space-y-6">
        <div className="text-sm text-gray-500">Loading company information...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">
          Company Setup
        </h1>
        <p className="text-sm text-gray-600">
          Complete your company setup to continue
        </p>
      </div>

      {reasonCompleteProfile && (
        <Alert className="bg-amber-50 border-amber-200 text-amber-900">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            Please complete your company profile to access the dashboard.
          </AlertDescription>
        </Alert>
      )}

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Company setup completed successfully. Redirecting...
          </AlertDescription>
        </Alert>
      )}

      {/* Form */}
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-gray-900">
            Company Information
          </CardTitle>
          <CardDescription>
            Required fields are marked with *
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Company Name */}
            <div>
              <Label htmlFor="companyName" className="text-sm font-medium">
                Company Name *
              </Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => handleCompanyNameChange(e.target.value)}
                placeholder="Enter your company name"
                required
                disabled={submitting}
                className="mt-1.5"
              />
            </div>

            {/* 2. Contact Person */}
            <div>
              <Label htmlFor="contactPerson" className="text-sm font-medium">
                Contact Person *
              </Label>
              <Input
                id="contactPerson"
                value={contactPerson}
                onChange={(e) => handleContactPersonChange(e.target.value)}
                placeholder="Full name of responsible person"
                required
                disabled={submitting}
                className="mt-1.5"
              />
            </div>

            {/* 3. Phone Number */}
            <div>
              <Label htmlFor="phone" className="text-sm font-medium">
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
                className="mt-1.5"
              />
            </div>

            {/* 4. Address */}
            <div>
              <Label htmlFor="address" className="text-sm font-medium">
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
                className="mt-1.5 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 5. Industry */}
            <div>
              <Label htmlFor="industry" className="text-sm font-medium">
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
                <SelectTrigger id="industry" className="mt-1.5">
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
              <Label htmlFor="businessType" className="text-sm font-medium">
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
                <SelectTrigger id="businessType" className="mt-1.5">
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
              <Label htmlFor="legalStructure" className="text-sm font-medium">
                Firm Type (Optional)
              </Label>
              <Select 
                value={legalStructure} 
                onValueChange={(v) => setLegalStructure(v as LegalStructure)}
                disabled={submitting}
              >
                <SelectTrigger id="legalStructure" className="mt-1.5">
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
              <Label htmlFor="businessCategory" className="text-sm font-medium">
                Business Category (Optional)
              </Label>
              <Select
                value={businessCategory}
                onValueChange={(v) => setBusinessCategory(v as BusinessCategory)}
                disabled={submitting}
              >
                <SelectTrigger id="businessCategory" className="mt-1.5">
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
            <div>
              <Label htmlFor="gstNumber" className="text-sm font-medium">
                GST Number (Optional)
              </Label>
              <Input
                id="gstNumber"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                placeholder="Enter GST number (optional)"
                disabled={submitting}
                className="mt-1.5"
              />
            </div>

            {/* 10. PAN (Optional) */}
            <div>
              <Label htmlFor="pan" className="text-sm font-medium">
                PAN (Optional)
              </Label>
              <Input
                id="pan"
                value={pan}
                onChange={(e) => setPan(e.target.value)}
                placeholder="Enter PAN (optional)"
                disabled={submitting}
                className="mt-1.5"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard')}
                disabled={submitting}
                className="border-gray-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !companyName.trim() || !contactPerson.trim() || !phone.trim() || !address.trim() || !industry || !businessType}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {submitting ? 'Saving...' : 'Complete Setup'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CompanySetupPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading...</div>}>
      <CompanySetupContent />
    </Suspense>
  );
}
