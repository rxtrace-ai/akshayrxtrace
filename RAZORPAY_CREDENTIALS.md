# Razorpay Live Configuration - Credentials Sheet

## ⚠️ IMPORTANT: Keep this file SECURE and NEVER commit to Git!

---

## Step 1: Live API Keys

### Navigate to: Settings → API Keys (Live Mode)

```
RAZORPAY_KEY_ID=rzp_live_
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_
```

**Saved:** [ ]

---

## Step 2: Subscription Plans

### Plan 1: Starter Monthly
- **Name:** RxTrace Starter Monthly
- **Amount:** ₹18,000
- **Interval:** 1 month
- **Plan ID:** 
```
RAZORPAY_SUBSCRIPTION_PLAN_ID_STARTER_MONTHLY=plan_
```
**Created:** [ ]

### Plan 2: Starter Annual
- **Name:** RxTrace Starter Annual
- **Amount:** ₹2,00,000
- **Interval:** 12 months
- **Plan ID:** 
```
RAZORPAY_SUBSCRIPTION_PLAN_ID_STARTER_ANNUAL=plan_
```
**Created:** [ ]

### Plan 3: Growth Monthly
- **Name:** RxTrace Growth Monthly
- **Amount:** ₹49,000
- **Interval:** 1 month
- **Plan ID:** 
```
RAZORPAY_SUBSCRIPTION_PLAN_ID_GROWTH_MONTHLY=plan_
```
**Created:** [ ]

### Plan 4: Growth Annual
- **Name:** RxTrace Growth Annual
- **Amount:** ₹5,00,000
- **Interval:** 12 months
- **Plan ID:** 
```
RAZORPAY_SUBSCRIPTION_PLAN_ID_GROWTH_ANNUAL=plan_
```
**Created:** [ ]

### Plan 5: Enterprise Monthly
- **Name:** RxTrace Enterprise Monthly
- **Amount:** ₹2,00,000
- **Interval:** 1 month
- **Plan ID:** 
```
RAZORPAY_SUBSCRIPTION_PLAN_ID_ENTERPRISE_MONTHLY=plan_
```
**Created:** [ ]

### Plan 6: Enterprise Quarterly
- **Name:** RxTrace Enterprise Quarterly
- **Amount:** ₹5,00,000
- **Interval:** 3 months (custom)
- **Plan ID:** 
```
RAZORPAY_SUBSCRIPTION_PLAN_ID_ENTERPRISE_QUARTERLY=plan_
```
**Created:** [ ]

---

## Step 3: Webhook Configuration

### Navigate to: Settings → Webhooks (Live Mode)

- **URL:** https://yourdomain.com/api/razorpay/webhook
  _(Update after Vercel deployment)_
- **Secret:** 
```
RAZORPAY_WEBHOOK_SECRET=
```
**Configured:** [ ]

### Events to Enable:
- [ ] subscription.charged
- [ ] subscription.activated
- [ ] subscription.cancelled
- [ ] subscription.paused
- [ ] subscription.resumed
- [ ] payment.failed
- [ ] payment.captured

---

## Final Environment Variables

Copy these to Vercel when deploying:

```bash
# Razorpay Live Keys
RAZORPAY_KEY_ID=rzp_live_
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_

# Subscription Plans
RAZORPAY_SUBSCRIPTION_PLAN_ID_STARTER_MONTHLY=plan_
RAZORPAY_SUBSCRIPTION_PLAN_ID_STARTER_ANNUAL=plan_
RAZORPAY_SUBSCRIPTION_PLAN_ID_GROWTH_MONTHLY=plan_
RAZORPAY_SUBSCRIPTION_PLAN_ID_GROWTH_ANNUAL=plan_
RAZORPAY_SUBSCRIPTION_PLAN_ID_ENTERPRISE_MONTHLY=plan_
RAZORPAY_SUBSCRIPTION_PLAN_ID_ENTERPRISE_QUARTERLY=plan_

# Webhook
RAZORPAY_WEBHOOK_SECRET=
```

---

## ✅ Checklist

- [ ] Switched to Live Mode
- [ ] Generated Live API Keys
- [ ] Created all 6 subscription plans
- [ ] Configured webhook (will update URL after deployment)
- [ ] All credentials saved in this file
- [ ] Ready to add to Vercel environment variables

---

**Date Configured:** _______________
**Configured By:** _______________
