-- Phase 9: invoice immutability + strict idempotency.
-- Invoices are read-only after insert, except one-time invoice_pdf_url population.

create unique index if not exists uniq_billing_invoices_company_reference
  on public.billing_invoices (company_id, reference)
  where reference is not null;

create or replace function public.enforce_billing_invoice_immutable()
returns trigger
language plpgsql
as $$
begin
  -- Allow one-time PDF attachment update when invoice_pdf_url was previously null.
  if old.invoice_pdf_url is null and new.invoice_pdf_url is not null then
    if new.company_id is distinct from old.company_id
      or new.invoice_type is distinct from old.invoice_type
      or new.status is distinct from old.status
      or new.reference is distinct from old.reference
      or new.plan is distinct from old.plan
      or new.amount is distinct from old.amount
      or new.base_amount is distinct from old.base_amount
      or new.addons_amount is distinct from old.addons_amount
      or new.discount_amount is distinct from old.discount_amount
      or new.tax_amount is distinct from old.tax_amount
      or new.currency is distinct from old.currency
      or new.provider is distinct from old.provider
      or new.provider_invoice_id is distinct from old.provider_invoice_id
      or new.provider_payment_id is distinct from old.provider_payment_id
      or new.provider_subscription_id is distinct from old.provider_subscription_id
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
      or new.due_at is distinct from old.due_at
      or new.issued_at is distinct from old.issued_at
      or new.paid_at is distinct from old.paid_at
      or new.checkout_session_id is distinct from old.checkout_session_id
      or new.metadata is distinct from old.metadata
      or new.created_at is distinct from old.created_at then
      raise exception 'BILLING_INVOICE_IMMUTABLE';
    end if;
    return new;
  end if;

  raise exception 'BILLING_INVOICE_IMMUTABLE';
end;
$$;

drop trigger if exists trg_billing_invoices_immutable on public.billing_invoices;
create trigger trg_billing_invoices_immutable
before update on public.billing_invoices
for each row
execute function public.enforce_billing_invoice_immutable();

