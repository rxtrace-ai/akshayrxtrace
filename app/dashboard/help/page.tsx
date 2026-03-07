'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HelpCircle, MessageSquare, FileText, Send } from 'lucide-react';
import TawkToChat from '@/components/TawkToChat';

// FAQ Data
const faqData = {
  activation: [
    {
      question: 'How do I activate SSCC scanning on my handset?',
      answer: 'To activate SSCC (Serial Shipping Container Code) scanning on your mobile scanner app:\n\n1. Open the RxTrace Scanner app on your device\n2. Tap the "Activate" button (🔑) in the top-right corner\n3. Enter your Company ID (UUID format)\n4. Tap "Activate" to register your device\n5. Once activated, you\'ll see "SSCC ready" status\n\nNote: Unit label scanning works without activation (free).',
    },
    {
      question: 'Where do I find my Company ID?',
      answer: 'Your Company ID is available in the web dashboard:\n\n1. Log in to your RxTrace dashboard at rxtrace.in\n2. Open Settings or your company profile area\n3. Copy the Company ID shown for your account\n4. Paste it into the activation field in the scanner app\n\nFormat: UUID (e.g., 944eb06e-f544-43bc-a8b4-f181fda68d21)',
    },
    {
      question: 'What\'s the difference between Unit and SSCC scanning?',
      answer: '• Unit Labels: Product-level codes containing GTIN (AI 01), serial number (AI 21), batch (AI 10), expiry date (AI 17), etc. Always free, no activation needed. Works offline and syncs when online.\n\n• SSCC Codes: Container-level codes for boxes, cartons, and pallets. Uses AI (00) with 18-digit format. Requires activation with Company ID. Charged per scan based on container type (box/carton/pallet).\n\nThe scanner app automatically detects which type you\'re scanning.',
    },
    {
      question: 'Can I deactivate my handset?',
      answer: 'Yes. To deactivate your handset:\n\n1. Open the Activation modal in the scanner app\n2. Tap "Deactivate" button\n3. This will:\n   • Remove JWT authentication\n   • Disable SSCC scanning\n   • Keep unit label scanning active (free)\n\nYou can reactivate anytime with your Company ID.',
    },
    {
      question: 'What if activation fails?',
      answer: 'If activation fails, check the following:\n\n• Verify your Company ID is correct (UUID format)\n• Ensure you have internet connection\n• Confirm your company account is active in the dashboard\n• Try again after a few moments\n• Check that the Company ID hasn\'t changed\n\nIf issues persist, contact support@rxtrace.in or submit a support request from this page.',
    },
    {
      question: 'How does handset registration work?',
      answer: 'When you activate with Company ID:\n\n1. The app generates a unique device fingerprint\n2. Sends a device registration request to the active scanner backend\n3. The backend links the device to your company\n4. The app stores the returned authentication token securely on the device\n5. SSCC scanning is enabled for that handset\n\nThis is a one-time process per device. The device fingerprint ensures each handset is uniquely identified.',
    },
    {
      question: 'Do I need to activate for unit label scanning?',
      answer: 'No. Unit label scanning is completely free and requires no activation:\n\n• Works immediately after app installation\n• No login or registration needed\n• No Company ID required\n• Works offline (scans saved locally)\n• Syncs verification when online\n\nActivation is only required for SSCC (container-level) scanning.',
    },
  ],
  technical: [
    {
      question: 'How do I generate GS1-compliant labels?',
      answer: 'Navigate to Code Generation, select your SKU, enter batch and expiry details, and choose your output format (PDF, PNG, ZPL, or EPL). The system automatically generates GS1-compliant codes with FNC1 separators.',
    },
    {
      question: 'What is the difference between GTIN and internal GTIN?',
      answer: 'GTIN (Global Trade Item Number) is issued by GS1 and is globally recognized. Internal GTINs are system-generated identifiers valid only within India and may not be export-compliant. Always use customer-provided GS1-issued GTINs when available.',
    },
    {
      question: 'How do I upload SKUs via CSV?',
      answer: 'Go to SKU Master, click Import CSV, and upload a file with headers: sku_code, sku_name. The system will validate and import your SKUs. Ensure CSV format matches the download template for best results.',
    },
    {
      question: 'Can I scan products without handset activation?',
      answer: 'Yes. Unit label scanning works immediately after installation. No login, activation, or device registration is required. Unit scanning is available to all users. SSCC scanning requires activation with Company ID.',
    },
    {
      question: 'How are duplicate scans handled?',
      answer: 'Duplicate scans are automatically detected and logged with status "DUPLICATE". They appear in scan logs and dashboard analytics but do not block the scan operation.',
    },
    {
      question: 'How does unit label scanning work?',
      answer: 'Unit labels contain:\n\n• GTIN (AI 01) - Product identifier\n• Serial Number (AI 21) - Unique item ID\n• Batch/Lot (AI 10) - Production batch\n• Expiry Date (AI 17) - Product expiry\n• Manufacturing Date (AI 11) - Production date\n• MRP (AI 91) - Maximum Retail Price\n• SKU (AI 92) - Stock Keeping Unit\n\nScanning is free and works offline (syncs when online).',
    },
    {
      question: 'How does SSCC code calculation work?',
      answer: 'SSCC (Serial Shipping Container Code) structure:\n\n• Format: (00) + 18 digits\n• Extension digit (1st): Container type indicator (0-2: box, 3-5: carton, 6-9: pallet)\n• Company prefix (7-9 digits): Your company identifier\n• Serial reference (8-10 digits): Unique container ID\n• Check digit (last): Validation digit\n\nThe scanner app automatically determines container type (box/carton/pallet) from the extension digit.',
    },
  ],
  billing: [
    {
      question: 'Is the free trial really free?',
      answer: 'Yes! The 15-day free trial requires no payment, no credit card, and no authorization charge. Start your trial from Settings after company setup.',
    },
    {
      question: 'How are scans billed?',
      answer: 'Unit-level scans are free. Box, carton, and pallet (SSCC) scans may be billed based on your pilot allocation. Check your pilot dashboard for usage details.',
    },
    {
      question: 'Can I purchase additional seats?',
      answer: 'Yes. Seats can be purchased as add-ons from the Settings page. Each seat allows one additional user to access the system.',
    },
    {
      question: 'Are printers and ERP code ingestion billed separately?',
      answer: 'No. Printer integrations are unlimited and free. ERP code ingestion (CSV import) is included in your plan. Export codes from your ERP and import via the ERP Code Ingestion page.',
    },
    {
      question: 'How do I view my invoices?',
      answer: 'Invoices are available in the Settings page during pilot access. You can view, download, and export invoice history.',
    },
  ],
  audit: [
    {
      question: 'How do I generate audit reports?',
      answer: 'Navigate to Reports > Audit Reports. You can filter by date range, product, batch, or scan type. Reports are exportable in CSV format for compliance purposes.',
    },
    {
      question: 'Are all scans audited?',
      answer: 'Yes. Every scan is logged with timestamp, IP address, device context, expiry status, and scan result. All actions are traceable in audit logs.',
    },
    {
      question: 'Can I export scan history for regulators?',
      answer: 'Yes. Scan logs can be exported from the Scan Logs page. The export includes all required fields for regulatory compliance and audit purposes.',
    },
    {
      question: 'How long is scan data retained?',
      answer: 'Scan data is retained according to your pilot allocation. Contact support for specific retention policies and archival options.',
    },
  ],
  compliance: [
    {
      question: 'Is RxTrace compliant with Indian pharmaceutical regulations?',
      answer: 'RxTrace generates GS1-compliant codes suitable for pharmaceutical traceability in India. Ensure you use GS1-issued GTINs for full regulatory compliance.',
    },
    {
      question: 'What is the difference between GS1-issued and internal GTINs?',
      answer: 'GS1-issued GTINs are globally recognized and export-compliant. Internal GTINs are system-generated and valid only within India. Always prefer GS1-issued GTINs for regulatory compliance.',
    },
    {
      question: 'How do I ensure my labels are export-compliant?',
      answer: 'Use customer-provided GS1-issued GTINs. Internal GTINs are marked with status "RXTRACE INTERNAL" and are not suitable for export. Check GTIN status in SKU Master.',
    },
    {
      question: 'Can I customize label formats for different markets?',
      answer: 'Label formats (PDF, PNG, ZPL, EPL) are standardized for GS1 compliance. Custom formats may affect regulatory acceptance. Contact support for market-specific requirements.',
    },
  ],
};

export default function HelpSupportPage() {
  const [formData, setFormData] = useState({
    fullName: '',
    companyName: '',
    email: '',
    category: '',
    priority: 'normal',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Backend support endpoint removed as part of legacy API cleanup.
      // Route users to email instead of storing in DB.
      const subject = encodeURIComponent(`RxTrace Support: ${formData.category || 'request'}`);
      const body = encodeURIComponent(
        `Name: ${formData.fullName}\nCompany: ${formData.companyName}\nEmail: ${formData.email}\nPriority: ${formData.priority}\n\nMessage:\n${formData.message}`
      );
      window.location.href = `mailto:support@rxtrace.in?subject=${subject}&body=${body}`;

      // Success - reset form and show success message
      setSubmitted(true);
      setSubmitting(false);
      setFormData({
        fullName: '',
        companyName: '',
        email: '',
        category: '',
        priority: 'normal',
        message: '',
      });

      // Reset success message after 5 seconds
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">Help & Support</h1>
        <p className="text-sm text-gray-600">Get assistance with technical issues, pilot access, and compliance</p>
      </div>

      {/* Tawk.to Chat Widget - Only visible on this page */}
      <TawkToChat />

      {/* Tabs */}
      <Tabs defaultValue="faq" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="support">Support Request</TabsTrigger>
          <TabsTrigger value="contact">Live Chat</TabsTrigger>
        </TabsList>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Frequently Asked Questions
              </CardTitle>
              <CardDescription>
                Find answers to common questions about RxTrace
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="activation" className="w-full">
                <TabsList className="grid w-full grid-cols-5 mb-6">
                  <TabsTrigger value="activation">Activation</TabsTrigger>
                  <TabsTrigger value="technical">Technical</TabsTrigger>
                  <TabsTrigger value="billing">Pilot Access</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                  <TabsTrigger value="compliance">Compliance</TabsTrigger>
                </TabsList>

                <TabsContent value="activation">
                  <Accordion type="single" collapsible className="w-full">
                    {faqData.activation.map((item, index) => (
                      <AccordionItem key={index} value={`activation-${index}`}>
                        <AccordionTrigger className="text-left font-medium text-gray-900">
                          {item.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-gray-600 whitespace-pre-line">
                          {item.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </TabsContent>

                <TabsContent value="technical">
                  <Accordion type="single" collapsible className="w-full">
                    {faqData.technical.map((item, index) => (
                      <AccordionItem key={index} value={`tech-${index}`}>
                        <AccordionTrigger className="text-left font-medium text-gray-900">
                          {item.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-gray-600">
                          {item.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </TabsContent>

                <TabsContent value="billing">
                  <Accordion type="single" collapsible className="w-full">
                    {faqData.billing.map((item, index) => (
                      <AccordionItem key={index} value={`billing-${index}`}>
                        <AccordionTrigger className="text-left font-medium text-gray-900">
                          {item.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-gray-600">
                          {item.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </TabsContent>

                <TabsContent value="audit">
                  <Accordion type="single" collapsible className="w-full">
                    {faqData.audit.map((item, index) => (
                      <AccordionItem key={index} value={`audit-${index}`}>
                        <AccordionTrigger className="text-left font-medium text-gray-900">
                          {item.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-gray-600">
                          {item.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </TabsContent>

                <TabsContent value="compliance">
                  <Accordion type="single" collapsible className="w-full">
                    {faqData.compliance.map((item, index) => (
                      <AccordionItem key={index} value={`compliance-${index}`}>
                        <AccordionTrigger className="text-left font-medium text-gray-900">
                          {item.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-gray-600">
                          {item.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Support Request Tab */}
        <TabsContent value="support">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                Submit Support Request
              </CardTitle>
              <CardDescription>
                Send your query to customer.support@rxtrace.in
              </CardDescription>
            </CardHeader>
            <CardContent>
              {submitted ? (
                <div className="p-6 bg-green-50 border border-green-200 rounded-lg text-center">
                  <p className="text-green-800 font-medium mb-1">Request submitted successfully</p>
                  <p className="text-sm text-green-700">Your request has been received. Our support team will contact you shortly.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="fullName">Full Name *</Label>
                      <Input
                        id="fullName"
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        required
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="companyName">Company Name *</Label>
                      <Input
                        id="companyName"
                        value={formData.companyName}
                        onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                        required
                        className="mt-1.5"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="email">Email Address *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                      className="mt-1.5"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="category">Support Category *</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) => setFormData({ ...formData, category: value })}
                        required
                      >
                        <SelectTrigger className="mt-1.5">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="technical">Technical Issue</SelectItem>
                          <SelectItem value="billing">Pilot Access Query</SelectItem>
                          <SelectItem value="audit">Audit / Compliance</SelectItem>
                          <SelectItem value="general">General Question</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="priority">Priority (Optional)</Label>
                      <Select
                        value={formData.priority}
                        onValueChange={(value) => setFormData({ ...formData, priority: value })}
                      >
                        <SelectTrigger className="mt-1.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="message">Message *</Label>
                    <Textarea
                      id="message"
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      required
                      rows={6}
                      className="mt-1.5"
                      placeholder="Describe your issue or question in detail..."
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800">{error}</p>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                      {submitting ? 'Submitting...' : 'Submit Request'}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Live Chat Tab */}
        <TabsContent value="contact">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Live Chat Support
              </CardTitle>
              <CardDescription>
                Chat with our support team for immediate assistance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-8 text-center border-2 border-dashed border-gray-300 rounded-lg">
                <HelpCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-700 font-medium mb-2">Tawk.to Live Chat</p>
                <p className="text-sm text-gray-600 mb-4">
                  The chat widget is loaded on this page. Look for the chat icon in the bottom-right corner to start a conversation.
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Available for: Technical issues, pilot access queries, Audit & Compliance questions
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
