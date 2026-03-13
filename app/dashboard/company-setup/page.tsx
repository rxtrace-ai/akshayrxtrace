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

// Type definitions
type LegalStructure = 'proprietorship' | 'partnership' | 'llp' | 'pvt_ltd' | 'other';
type BusinessType = 'manufacturer' | 'distributor' | 'wholesaler' | 'exporter' | 'importer' | 'cf_agent';
type OperationType = 'manufacturing' | 'packing' | 'import' | 'export' | 'distribution' | 'retail';
type Industry = 'pharma' | 'medical_devices' | 'fmcg' | 'cosmetics' | 'food' | 'packaging' | 'printing';

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
  const [legalStructure, setLegalStructure] = useState<LegalStructure | ''>('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [operationTypes, setOperationTypes] = useState<OperationType[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);

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
        .select('id, company_name, contact_person, contact_person_name, phone, address, firm_type, business_category, business_type, profile_completed')
        .eq('user_id', user.id)
        .maybeSingle();

      // Load existing data if available
      if (existingCompany?.id) {
        setCompanyName(existingCompany.company_name || '');
        setContactPerson(
          existingCompany.contact_person ||
          existingCompany.contact_person_name ||
          ''
        );
        setPhone(existingCompany.phone || '');
        setAddress(existingCompany.address || '');
        if (existingCompany.firm_type) {
          setLegalStructure(existingCompany.firm_type as LegalStructure);
        }
        // Load business_type (single value matching dropdown)
        if (existingCompany.business_type) {
          const bt = existingCompany.business_type.toLowerCase().trim();
          if (['manufacturer', 'distributor', 'wholesaler', 'exporter', 'importer', 'cf_agent'].includes(bt)) {
            setBusinessType(bt as BusinessType);
          }
        }
        // Note: operationTypes are not stored in business_type field anymore
        // They would need to be stored separately if needed in the future
        // business_category maps to industries (single value in DB, but we support multi-select)
        if (existingCompany.business_category) {
          const industryMap: Record<string, Industry> = {
            'pharma': 'pharma',
            'food': 'food',
            'dairy': 'food',
            'logistics': 'packaging',
          };
          const mapped = industryMap[existingCompany.business_category];
          if (mapped) {
            setIndustries([mapped]);
          }
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
    if (!legalStructure) {
      setError('Type of Company is required');
      setSubmitting(false);
      return;
    }
    if (!businessType) {
      setError('Type of Business is required');
      setSubmitting(false);
      return;
    }
    if (operationTypes.length === 0) {
      setError('At least one Type of Operation must be selected');
      setSubmitting(false);
      return;
    }
    if (industries.length === 0) {
      setError('At least one Industry must be selected');
      setSubmitting(false);
      return;
    }

    // Map industries to business_category (use first industry as primary)
    const businessCategory = industries[0] === 'pharma' ? 'pharma' :
                            industries[0] === 'food' ? 'food' :
                            industries[0] === 'packaging' ? 'logistics' :
                            'pharma'; // Default

    // Call server action (backend-first execution path)
    const result = await createOrUpdateCompanyProfile({
      company_name: companyName.trim(),
      contact_person: contactPerson.trim(),
      phone: phone.trim(),
      address: address.trim(),
      firm_type: legalStructure,
      business_type: businessType,
      business_category: businessCategory,
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

  const toggleOperationType = (op: OperationType) => {
    setOperationTypes(prev => 
      prev.includes(op) 
        ? prev.filter(t => t !== op)
        : [...prev, op]
    );
    // Clear error when user makes selection
    if (error && error.includes('Operation')) {
      setError('');
    }
  };

  const toggleIndustry = (industry: Industry) => {
    setIndustries(prev => 
      prev.includes(industry)
        ? prev.filter(i => i !== industry)
        : [...prev, industry]
    );
    // Clear error when user makes selection
    if (error && error.includes('Industry')) {
      setError('');
    }
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
            All fields are required to complete setup
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
                placeholder="Enter company name"
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
                placeholder="Enter contact person name"
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
                placeholder="Enter phone number"
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
                placeholder="Enter company address"
                required
                rows={3}
                disabled={submitting}
                className="mt-1.5 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 5. Type of Company (Legal Structure) */}
            <div>
              <Label htmlFor="legalStructure" className="text-sm font-medium">
                Type of Company (Legal Structure) *
              </Label>
              <Select 
                value={legalStructure} 
                onValueChange={(v) => {
                  setLegalStructure(v as LegalStructure);
                  if (error && error.includes('Company')) {
                    setError('');
                  }
                }}
                disabled={submitting}
              >
                <SelectTrigger id="legalStructure" className="mt-1.5">
                  <SelectValue placeholder="Select legal structure" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="proprietorship">Proprietorship</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="llp">LLP</SelectItem>
                  <SelectItem value="pvt_ltd">Pvt Ltd</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 6. Type of Business */}
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
                  <SelectValue placeholder="Select business type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manufacturer">Manufacturer</SelectItem>
                  <SelectItem value="distributor">Distributor</SelectItem>
                  <SelectItem value="wholesaler">Wholesaler</SelectItem>
                  <SelectItem value="exporter">Exporter</SelectItem>
                  <SelectItem value="importer">Importer</SelectItem>
                  <SelectItem value="cf_agent">C&F Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 7. Type of Operation (Multi-select) */}
            <div>
              <Label className="text-sm font-medium">
                Type of Operation (Select all that apply) *
              </Label>
              <div className="mt-2 space-y-2">
                {(['manufacturing', 'packing', 'import', 'export', 'distribution', 'retail'] as OperationType[]).map((op: OperationType) => (
                  <label key={op} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={operationTypes.includes(op)}
                      onChange={() => toggleOperationType(op)}
                      disabled={submitting}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 capitalize">
                      {op}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* 8. Industries (Multi-select) */}
            <div>
              <Label className="text-sm font-medium">
                Industries (Select all that apply) *
              </Label>
              <div className="mt-2 space-y-2">
                {([
                  { value: 'pharma' as Industry, label: 'Pharma' },
                  { value: 'medical_devices' as Industry, label: 'Medical Devices' },
                  { value: 'fmcg' as Industry, label: 'FMCG' },
                  { value: 'cosmetics' as Industry, label: 'Cosmetics' },
                  { value: 'food' as Industry, label: 'Food' },
                  { value: 'packaging' as Industry, label: 'Packaging' },
                  { value: 'printing' as Industry, label: 'Printing' },
                ]).map(({ value, label }) => (
                  <label key={value} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={industries.includes(value)}
                      onChange={() => toggleIndustry(value)}
                      disabled={submitting}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
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
                disabled={submitting || !companyName.trim() || !contactPerson.trim() || !phone.trim() || !address.trim() || !legalStructure || !businessType || operationTypes.length === 0 || industries.length === 0}
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
