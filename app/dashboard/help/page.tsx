'use client';

import { useState } from 'react';
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

const faqSections = [
  {
    key: 'getting-started',
    label: 'Getting Started',
    items: [
      {
        question: 'How do I start using Rxtrace after signup?',
        answer: 'Complete company setup, add your first product or SKU details, and then move to code generation to begin testing your traceability flow.',
      },
      {
        question: 'Do I need GTIN before using the platform?',
        answer: 'No. If you already have GTIN, Rxtrace can work with it. If you do not, you can still use PIC-based identification for internal traceability flows.',
      },
      {
        question: 'Where should my team begin first?',
        answer: 'Start with company setup, product setup, and then a small code-generation test so your team can understand the flow before doing larger batches.',
      },
    ],
  },
  {
    key: 'code-generation',
    label: 'Code Generation',
    items: [
      {
        question: 'How does unit code generation work?',
        answer: 'Select the relevant product or SKU record, enter the quantity, and generate codes. Rxtrace uses GTIN-based or PIC-based flow depending on the available product data.',
      },
      {
        question: 'Can I generate packaging hierarchy too?',
        answer: 'Yes. Rxtrace supports unit, box, carton, and pallet traceability so you can maintain packaging relationships across the supply chain.',
      },
      {
        question: 'What formats can I export?',
        answer: 'Depending on the workflow, you can export labels in supported operational formats such as PDF, PNG, ZPL, or EPL.',
      },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    items: [
      {
        question: 'Where can I review subscription and add-on status?',
        answer: 'Use the Subscription and Add-ons pages in your dashboard to review plan details, purchases, and current usage-related context.',
      },
      {
        question: 'Can I buy additional capacity or code top-ups?',
        answer: 'Yes. Add-ons are available separately so you can increase capacity or code volume without changing unrelated parts of your subscription.',
      },
      {
        question: 'Where are invoices available?',
        answer: 'Invoices and billing records are available from the billing and subscription-related sections of the dashboard when applicable to your account.',
      },
    ],
  },
  {
    key: 'compliance',
    label: 'Compliance',
    items: [
      {
        question: 'Does Rxtrace make us automatically compliant?',
        answer: 'No. Rxtrace supports compliance-oriented workflows, but final compliance depends on your implementation and the rules that apply to your market.',
      },
      {
        question: 'Does Rxtrace verify GTIN ownership?',
        answer: 'No. Rxtrace reads GTIN structure for workflows, but your company is solely responsible for valid GTIN ownership and lawful use.',
      },
      {
        question: 'Can we use Rxtrace for audit preparation?',
        answer: 'Yes. The platform is designed to support clear records, traceability history, and audit-friendly reporting workflows.',
      },
    ],
  },
];

export default function HelpSupportPage() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    category: '',
    priority: 'normal',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/user/support-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: formData.fullName,
          email: formData.email,
          category: formData.category,
          priority: formData.priority,
          message: formData.message,
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error?.message || payload?.error || 'Failed to submit request. Please try again.');
      }

      setSubmitted(true);
      setFormData({
        fullName: '',
        email: '',
        category: '',
        priority: 'normal',
        message: '',
      });
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1.5 text-3xl font-semibold text-gray-900">Help &amp; Support</h1>
        <p className="text-sm text-gray-600">Find quick answers, submit support requests, or start a live chat with our team.</p>
      </div>

      <TawkToChat />

      <Tabs defaultValue="faq" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="faq">FAQs</TabsTrigger>
          <TabsTrigger value="support">Support Form</TabsTrigger>
          <TabsTrigger value="contact">Live Chat</TabsTrigger>
        </TabsList>

        <TabsContent value="faq" className="space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Frequently Asked Questions
              </CardTitle>
              <CardDescription>Clear, simple answers for the most common product, billing, and compliance questions.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={faqSections[0].key} className="w-full">
                <TabsList className="mb-6 grid w-full grid-cols-2 gap-2 md:grid-cols-4">
                  {faqSections.map((section) => (
                    <TabsTrigger key={section.key} value={section.key}>
                      {section.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {faqSections.map((section) => (
                  <TabsContent key={section.key} value={section.key}>
                    <Accordion type="single" collapsible className="w-full">
                      {section.items.map((item, index) => (
                        <AccordionItem key={item.question} value={`${section.key}-${index}`}>
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
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="support">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Submit Support Request
              </CardTitle>
              <CardDescription>Your request is stored in the admin support queue so the team can follow up properly.</CardDescription>
            </CardHeader>
            <CardContent>
              {submitted ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
                  <p className="mb-1 font-medium text-green-800">Request submitted successfully</p>
                  <p className="text-sm text-green-700">Your request is now visible to the admin support team.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="fullName">Full Name *</Label>
                      <Input
                        id="fullName"
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        required
                        className="mt-1.5"
                        placeholder="Your name"
                      />
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
                        placeholder="you@company.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="category">Support Category *</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) => setFormData({ ...formData, category: value })}
                      >
                        <SelectTrigger className="mt-1.5">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="technical">Technical Issue</SelectItem>
                          <SelectItem value="billing">Billing / Subscription</SelectItem>
                          <SelectItem value="compliance">Compliance / Audit</SelectItem>
                          <SelectItem value="general">General Question</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="priority">Priority</Label>
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
                      placeholder="Describe your issue, question, or the help you need."
                    />
                  </div>

                  {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-sm text-red-800">{error}</p>
                    </div>
                  ) : null}

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

        <TabsContent value="contact">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Live Chat Support
              </CardTitle>
              <CardDescription>Use the chat widget on this page for quick guidance and operational help.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
                <HelpCircle className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                <p className="mb-2 font-medium text-gray-700">Live chat is active on this page</p>
                <p className="text-sm text-gray-600">
                  Look for the chat icon in the bottom-right corner to start a conversation with the support team.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
