## Phase 1 Trial Flow

- **Automatic 15-day trial** – Every newly created company now starts a trial window (`trial_started_at` / `trial_expires_at` in `companies`). No manual activation is required.
- **Usage enforcement** – Trial generation limits for units, boxes, cartons, pallets, seats, and plants are enforced server-side via `lib/trial`. Active trials ignore bonus/subscription logic.
- **Dashboard summary** – `/api/user/dashboard/summary` exposes `trial_active`, `days_remaining`, per-metric `limits` and `usage`, plus the global seat/plant indicators. Frontend components must consume this endpoint instead of directly hitting Postgres or the legacy `/api/trial/*` routes.
- **Admin reset** – `/api/admin/companies/[id]/reset-trial` now reuses `startTrialForCompany` to refresh timestamps without touching bonus/subscription/add-on rows.
- **Upgrade path** – When a paid subscription becomes active (detected via `assertCompanyCanOperate`), the trial timestamps are cleared so the company is no longer treated as an expired trial.
- **Future considerations** – Coupon visibility, plant creation, and other resources can be wrapped with the same trial guard exported from `lib/trial` when wider enforcement is required.
