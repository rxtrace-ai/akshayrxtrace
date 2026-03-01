-- PHASE-14: Real-Time Alerting & Incident Response
-- This migration creates tables for alert rules and alert history

-- ============================================================================
-- Alert Rules Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('error_rate', 'latency', 'success_rate', 'request_volume', 'database_health')),
  threshold_type TEXT NOT NULL CHECK (threshold_type IN ('greater_than', 'less_than', 'equals')),
  threshold_value NUMERIC NOT NULL,
  route_pattern TEXT, -- Optional: specific route or pattern (e.g., '/api/admin/*')
  method TEXT, -- Optional: specific HTTP method
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')) DEFAULT 'warning',
  enabled BOOLEAN DEFAULT true,
  cooldown_minutes INTEGER DEFAULT 15,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of channel configs
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- ============================================================================
-- Alert History Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  message TEXT NOT NULL,
  metric_value NUMERIC,
  threshold_value NUMERIC,
  route TEXT,
  method TEXT,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'acknowledged')),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_alert_rules_metric_type ON alert_rules(metric_type);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule_id ON alert_history(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_status ON alert_history(status);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at ON alert_history(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_severity ON alert_history(severity);

-- ============================================================================
-- Update Timestamp Trigger
-- ============================================================================

-- Reuse existing update_updated_at_column function from previous migrations
DROP TRIGGER IF EXISTS update_alert_rules_updated_at ON alert_rules;
CREATE TRIGGER update_alert_rules_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE alert_rules IS
'PHASE-14: Alert rules define conditions that trigger alerts when metrics breach thresholds.';

COMMENT ON TABLE alert_history IS
'PHASE-14: Alert history stores all triggered alerts with their status and resolution information.';

COMMENT ON COLUMN alert_rules.channels IS
'PHASE-14: JSON array of alert channel configurations. Example: [{"type": "email", "recipients": ["admin@example.com"]}, {"type": "slack", "webhook": "https://..."}]';

COMMENT ON COLUMN alert_rules.cooldown_minutes IS
'PHASE-14: Minimum minutes between alerts for the same rule to prevent alert spam.';

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role can manage alert_rules"
  ON alert_rules
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage alert_history"
  ON alert_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users (admins) can read and manage alert rules
CREATE POLICY "Authenticated users can read alert_rules"
  ON alert_rules
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage alert_rules"
  ON alert_rules
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users (admins) can read alert history
CREATE POLICY "Authenticated users can read alert_history"
  ON alert_history
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update alert_history"
  ON alert_history
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
