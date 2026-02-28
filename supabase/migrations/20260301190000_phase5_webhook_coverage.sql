-- Phase 5.1: Expand Razorpay webhook coverage (canonical billing)
-- Handles:
-- - subscription.* lifecycle events
-- - invoice.paid / invoice.payment_failed
-- - order.paid / payment.captured mapped to combined checkout top-up leg
-- Keeps idempotency via webhook_events.event_id unique constraint.

CREATE OR REPLACE FUNCTION public.process_razorpay_webhook_event(
  p_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_correlation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhook_id uuid;

  v_order_id text;
  v_payment_id text;
  v_order_row record;

  v_company_id uuid;
  v_amount numeric;
  v_wallet_tx record;

  v_subscription_id text;
  v_subscription_event text;
  v_subscription_status text;
  v_subscription_entity jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_plan_template_id uuid;
  v_plan_version_id uuid;
  v_checkout_session_id uuid;
  v_checkout_session record;

  v_invoice_id text;
  v_invoice_entity jsonb;
  v_invoice_status text;
  v_invoice_paid_at timestamptz;
  v_invoice_pdf_url text;

  v_result jsonb := '{}'::jsonb;
  v_now timestamptz := now();
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'INVALID_EVENT_ID';
  END IF;

  INSERT INTO public.webhook_events (
    event_id,
    event_type,
    payload_json,
    correlation_id,
    received_at,
    processing_status,
    retry_count
  )
  VALUES (
    p_event_id,
    coalesce(nullif(btrim(p_event_type), ''), 'unknown'),
    coalesce(p_payload, '{}'::jsonb),
    p_correlation_id,
    v_now,
    'received',
    0
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_webhook_id;

  IF v_webhook_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true);
  END IF;

  UPDATE public.webhook_events
  SET processing_status = 'processing'
  WHERE id = v_webhook_id;

  -- =========================================================
  -- Subscription lifecycle events
  -- =========================================================
  IF p_event_type LIKE 'subscription.%' THEN
    v_subscription_id := p_payload #>> '{payload,subscription,entity,id}';
    v_subscription_entity := coalesce(p_payload #> '{payload,subscription,entity}', '{}'::jsonb);
    v_subscription_event := lower(coalesce(nullif(split_part(p_event_type, '.', 2), ''), 'unknown'));

    v_subscription_status := CASE v_subscription_event
      WHEN 'authenticated' THEN 'authenticated'
      WHEN 'activated' THEN 'active'
      WHEN 'charged' THEN 'active'
      WHEN 'paused' THEN 'paused'
      WHEN 'resumed' THEN 'active'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'completed' THEN 'completed'
      ELSE 'pending'
    END;

    IF v_subscription_id IS NOT NULL AND btrim(v_subscription_id) <> '' THEN
      -- Prefer session linkage (combined checkout), fallback to existing subscription.
      SELECT cs.id, cs.company_id
      INTO v_checkout_session_id, v_company_id
      FROM public.checkout_sessions cs
      WHERE cs.provider_subscription_id = v_subscription_id
      ORDER BY cs.created_at DESC
      LIMIT 1;

      IF v_company_id IS NULL THEN
        SELECT csub.company_id
        INTO v_company_id
        FROM public.company_subscriptions csub
        WHERE csub.razorpay_subscription_id = v_subscription_id
        ORDER BY csub.updated_at DESC, csub.created_at DESC
        LIMIT 1;
      END IF;

      IF v_company_id IS NOT NULL THEN
        SELECT
          cs.id,
          cs.selected_plan_template_id,
          cs.selected_plan_version_id
        INTO v_checkout_session
        FROM public.checkout_sessions cs
        WHERE cs.provider_subscription_id = v_subscription_id
        ORDER BY cs.created_at DESC
        LIMIT 1;

        v_plan_template_id := (v_checkout_session).selected_plan_template_id;
        v_plan_version_id := (v_checkout_session).selected_plan_version_id;

        -- Period timestamps (Razorpay sends epoch seconds in different keys depending on event)
        v_period_start := NULL;
        v_period_end := NULL;
        BEGIN
          IF (v_subscription_entity ? 'current_start') THEN
            v_period_start := to_timestamp((v_subscription_entity #>> '{current_start}')::bigint);
          ELSIF (v_subscription_entity ? 'current_period_start') THEN
            v_period_start := to_timestamp((v_subscription_entity #>> '{current_period_start}')::bigint);
          END IF;
        EXCEPTION WHEN others THEN
          v_period_start := NULL;
        END;
        BEGIN
          IF (v_subscription_entity ? 'current_end') THEN
            v_period_end := to_timestamp((v_subscription_entity #>> '{current_end}')::bigint);
          ELSIF (v_subscription_entity ? 'current_period_end') THEN
            v_period_end := to_timestamp((v_subscription_entity #>> '{current_period_end}')::bigint);
          END IF;
        EXCEPTION WHEN others THEN
          v_period_end := NULL;
        END;

        -- Upsert canonical company subscription (no hard dependency on UNIQUE(company_id)).
        UPDATE public.company_subscriptions
        SET
          status = v_subscription_status,
          plan_template_id = COALESCE(v_plan_template_id, plan_template_id),
          plan_version_id = COALESCE(v_plan_version_id, plan_version_id),
          razorpay_subscription_id = COALESCE(NULLIF(v_subscription_id, ''), razorpay_subscription_id),
          current_period_start = COALESCE(v_period_start, current_period_start),
          current_period_end = COALESCE(v_period_end, current_period_end),
          next_billing_at = COALESCE(v_period_end, next_billing_at),
          activated_at = CASE
            WHEN activated_at IS NOT NULL THEN activated_at
            WHEN v_subscription_status = 'active' THEN v_now
            ELSE NULL
          END,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_event_id', p_event_id, 'last_event_type', p_event_type),
          updated_at = v_now
        WHERE company_id = v_company_id
          AND (razorpay_subscription_id IS NULL OR razorpay_subscription_id = v_subscription_id);

        IF NOT FOUND THEN
          INSERT INTO public.company_subscriptions (
            company_id,
            status,
            plan_template_id,
            plan_version_id,
            razorpay_subscription_id,
            current_period_start,
            current_period_end,
            next_billing_at,
            activated_at,
            metadata,
            created_at,
            updated_at
          )
          VALUES (
            v_company_id,
            v_subscription_status,
            v_plan_template_id,
            v_plan_version_id,
            v_subscription_id,
            v_period_start,
            v_period_end,
            v_period_end,
            CASE WHEN v_subscription_status = 'active' THEN v_now ELSE NULL END,
            jsonb_build_object('last_event_id', p_event_id, 'last_event_type', p_event_type),
            v_now,
            v_now
          );
        END IF;

        -- Reset base plan usage counters at activation / charge when a valid new period exists.
        IF v_subscription_status = 'active' AND v_period_start IS NOT NULL AND v_period_end IS NOT NULL AND v_period_end > v_period_start THEN
          PERFORM public.apply_cycle_reset(v_company_id, v_period_start, v_period_end);
        END IF;

        -- Advance combined checkout session state (if present).
        IF v_checkout_session_id IS NOT NULL THEN
          UPDATE public.checkout_sessions
          SET
            status = CASE
              WHEN topup_payload_json IS NULL THEN 'completed'::public.checkout_session_status_enum
              ELSE 'subscription_paid'::public.checkout_session_status_enum
            END,
            completed_at = CASE WHEN topup_payload_json IS NULL THEN v_now ELSE completed_at END,
            updated_at = v_now
          WHERE id = v_checkout_session_id
            AND status IN ('created', 'quote_locked', 'subscription_initiated', 'failed', 'cancelled', 'expired', 'partial_success');
        END IF;

        v_result := v_result || jsonb_build_object(
          'subscription', jsonb_build_object(
            'subscription_id', v_subscription_id,
            'status', v_subscription_status,
            'company_id', v_company_id
          )
        );
      END IF;
    END IF;
  END IF;

  -- =========================================================
  -- Invoice events (subscription invoices)
  -- =========================================================
  IF p_event_type IN ('invoice.paid', 'invoice.payment_failed') THEN
    v_invoice_entity := coalesce(p_payload #> '{payload,invoice,entity}', '{}'::jsonb);
    v_invoice_id := v_invoice_entity #>> '{id}';
    v_subscription_id := coalesce(v_invoice_entity #>> '{subscription_id}', v_invoice_entity #>> '{subscription}');

    v_invoice_status := CASE
      WHEN p_event_type = 'invoice.paid' THEN 'paid'
      WHEN p_event_type = 'invoice.payment_failed' THEN 'payment_failed'
      ELSE 'issued'
    END;

    v_invoice_pdf_url := v_invoice_entity #>> '{short_url}';
    IF v_invoice_pdf_url IS NULL OR btrim(v_invoice_pdf_url) = '' THEN
      v_invoice_pdf_url := v_invoice_entity #>> '{invoice_pdf}';
    END IF;

    v_invoice_paid_at := NULL;
    BEGIN
      IF (v_invoice_entity ? 'paid_at') THEN
        v_invoice_paid_at := to_timestamp((v_invoice_entity #>> '{paid_at}')::bigint);
      END IF;
    EXCEPTION WHEN others THEN
      v_invoice_paid_at := NULL;
    END;

    IF v_subscription_id IS NOT NULL AND btrim(v_subscription_id) <> '' THEN
      SELECT csub.company_id INTO v_company_id
      FROM public.company_subscriptions csub
      WHERE csub.razorpay_subscription_id = v_subscription_id
      ORDER BY csub.updated_at DESC, csub.created_at DESC
      LIMIT 1;
    END IF;

    IF v_company_id IS NOT NULL AND v_invoice_id IS NOT NULL AND btrim(v_invoice_id) <> '' THEN
      INSERT INTO public.billing_invoices (
        company_id,
        invoice_type,
        status,
        provider,
        provider_invoice_id,
        provider_subscription_id,
        provider_payment_id,
        invoice_pdf_url,
        issued_at,
        paid_at,
        metadata,
        updated_at
      )
      VALUES (
        v_company_id,
        'subscription',
        v_invoice_status,
        'razorpay',
        v_invoice_id,
        v_subscription_id,
        v_invoice_entity #>> '{payment_id}',
        v_invoice_pdf_url,
        v_now,
        v_invoice_paid_at,
        jsonb_build_object('last_event_id', p_event_id, 'last_event_type', p_event_type),
        v_now
      )
      ON CONFLICT (provider, provider_invoice_id) DO UPDATE
      SET
        status = EXCLUDED.status,
        provider_payment_id = COALESCE(EXCLUDED.provider_payment_id, public.billing_invoices.provider_payment_id),
        invoice_pdf_url = COALESCE(EXCLUDED.invoice_pdf_url, public.billing_invoices.invoice_pdf_url),
        paid_at = COALESCE(EXCLUDED.paid_at, public.billing_invoices.paid_at),
        metadata = COALESCE(public.billing_invoices.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = v_now;

      v_result := v_result || jsonb_build_object(
        'invoice', jsonb_build_object(
          'invoice_id', v_invoice_id,
          'status', v_invoice_status,
          'company_id', v_company_id
        )
      );
    END IF;
  END IF;

  -- =========================================================
  -- Order / payment events (top-up leg + wallet topups)
  -- =========================================================
  IF p_event_type IN ('order.paid', 'payment.captured') THEN
    v_order_id := COALESCE(
      p_payload #>> '{payload,order,entity,id}',
      p_payload #>> '{payload,payment,entity,order_id}'
    );
    v_payment_id := p_payload #>> '{payload,payment,entity,id}';

    -- 1) Legacy wallet top-ups (existing behavior)
    IF v_order_id IS NOT NULL AND btrim(v_order_id) <> '' THEN
      UPDATE public.razorpay_orders
      SET status = 'paid',
          paid_at = v_now,
          payment_id = COALESCE(NULLIF(v_payment_id, ''), payment_id)
      WHERE order_id = v_order_id
        AND status <> 'paid'
      RETURNING * INTO v_order_row;

      IF v_order_row IS NOT NULL THEN
        IF v_order_row.purpose ~ '^wallet_topup_company_.+$' THEN
          v_company_id := substring(v_order_row.purpose from '^wallet_topup_company_(.+)$')::uuid;
          v_amount := coalesce(v_order_row.amount, 0);

          IF v_company_id IS NOT NULL AND v_amount > 0 THEN
            SELECT * INTO v_wallet_tx
            FROM public.wallet_update_and_record(
              p_company_id := v_company_id::text,
              p_op := 'TOPUP',
              p_amount := v_amount,
              p_reference := 'razorpay_topup:' || v_order_id,
              p_created_by := NULL
            );

            v_result := v_result || jsonb_build_object(
              'wallet_topup', jsonb_build_object(
                'company_id', v_company_id,
                'amount', v_amount,
                'wallet_tx_id', v_wallet_tx.id
              )
            );
          END IF;
        END IF;
      END IF;

      -- 2) Canonical checkout top-up leg mapping (order_id -> checkout_sessions)
      SELECT *
      INTO v_checkout_session
      FROM public.checkout_sessions cs
      WHERE cs.provider_topup_order_id = v_order_id
      ORDER BY cs.created_at DESC
      LIMIT 1;

      IF FOUND THEN
        v_company_id := (v_checkout_session).company_id;
        v_checkout_session_id := (v_checkout_session).id;

        -- Insert one top-up row per line (enforce uniqueness by suffixing payment_id with metric key).
        -- NOTE: this supports multi-metric orders even though provider has one payment_id.
        INSERT INTO public.company_addon_topups (
          company_id,
          addon_id,
          entitlement_key,
          purchased_quantity,
          consumed_quantity,
          status,
          checkout_session_id,
          provider,
          provider_order_id,
          provider_payment_id,
          amount,
          currency,
          metadata,
          created_at,
          updated_at
        )
        SELECT
          v_company_id,
          (line->>'addon_id')::uuid,
          (line->>'entitlement_key')::public.entitlement_key_enum,
          GREATEST((line->>'quantity')::bigint, 1),
          0,
          'paid',
          v_checkout_session_id,
          'razorpay',
          v_order_id,
          CASE
            WHEN v_payment_id IS NULL OR btrim(v_payment_id) = '' THEN NULL
            ELSE v_payment_id || ':' || (line->>'entitlement_key')
          END,
          COALESCE(((line->>'line_total_paise')::numeric / 100.0), 0),
          'INR',
          jsonb_build_object(
            'razorpay_payment_id', v_payment_id,
            'event_id', p_event_id,
            'event_type', p_event_type
          ),
          v_now,
          v_now
        FROM jsonb_array_elements(coalesce((v_checkout_session).quote_payload_json->'variable_topups', '[]'::jsonb)) AS line
        ON CONFLICT (provider, provider_payment_id) DO NOTHING;

        UPDATE public.checkout_sessions
        SET status = CASE
            WHEN status IN ('subscription_paid', 'partial_success', 'topup_initiated') THEN 'topup_paid'
            ELSE status
          END,
          completed_at = CASE
            WHEN status IN ('subscription_paid', 'partial_success') THEN v_now
            ELSE completed_at
          END,
          updated_at = v_now
        WHERE id = v_checkout_session_id;

        -- If subscription leg already paid, mark session completed.
        UPDATE public.checkout_sessions
        SET
          status = 'completed'::public.checkout_session_status_enum,
          completed_at = COALESCE(completed_at, v_now),
          updated_at = v_now
        WHERE id = v_checkout_session_id
          AND status IN ('topup_paid');

        v_result := v_result || jsonb_build_object(
          'topup', jsonb_build_object(
            'company_id', v_company_id,
            'order_id', v_order_id,
            'payment_id', v_payment_id,
            'checkout_session_id', v_checkout_session_id
          )
        );
      END IF;
    END IF;
  END IF;

  UPDATE public.webhook_events
  SET processing_status = 'processed',
      processed_at = v_now,
      error_message = NULL
  WHERE id = v_webhook_id;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'event_id', p_event_id,
    'event_type', coalesce(nullif(btrim(p_event_type), ''), 'unknown'),
    'result', v_result
  );
EXCEPTION WHEN others THEN
  UPDATE public.webhook_events
  SET processing_status = 'failed',
      processed_at = now(),
      error_message = SQLERRM
  WHERE id = v_webhook_id;
  RAISE;
END;
$$;
