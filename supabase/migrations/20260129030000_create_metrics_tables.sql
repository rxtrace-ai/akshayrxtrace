-- PHASE-12: Production Metrics Storage
-- This migration creates tables for storing route and operation metrics persistently

-- ============================================================================
-- Route Metrics Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS route_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  total_requests INTEGER DEFAULT 0,
  successful INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  total_duration_ms BIGINT DEFAULT 0,
  average_duration_ms NUMERIC(10, 2),
  last_request_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(route, method, period_start, period_end)
);

-- ============================================================================
-- Operation Metrics Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS operation_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,
  total_executions INTEGER DEFAULT 0,
  successful INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  total_duration_ms BIGINT DEFAULT 0,
  average_duration_ms NUMERIC(10, 2),
  last_execution_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(operation, period_start, period_end)
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Route metrics indexes
CREATE INDEX IF NOT EXISTS idx_route_metrics_route_method ON route_metrics(route, method);
CREATE INDEX IF NOT EXISTS idx_route_metrics_period ON route_metrics(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_route_metrics_last_request ON route_metrics(last_request_at);

-- Operation metrics indexes
CREATE INDEX IF NOT EXISTS idx_operation_metrics_operation ON operation_metrics(operation);
CREATE INDEX IF NOT EXISTS idx_operation_metrics_period ON operation_metrics(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_operation_metrics_last_execution ON operation_metrics(last_execution_at);

-- ============================================================================
-- Update Timestamp Trigger Function
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to route_metrics
DROP TRIGGER IF EXISTS update_route_metrics_updated_at ON route_metrics;
CREATE TRIGGER update_route_metrics_updated_at
  BEFORE UPDATE ON route_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to operation_metrics
DROP TRIGGER IF EXISTS update_operation_metrics_updated_at ON operation_metrics;
CREATE TRIGGER update_operation_metrics_updated_at
  BEFORE UPDATE ON operation_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE route_metrics IS
'PHASE-12: Stores route-level metrics for API endpoints. Metrics are aggregated by time period (e.g., hourly, daily).';

COMMENT ON TABLE operation_metrics IS
'PHASE-12: Stores operation-level metrics for internal operations. Metrics are aggregated by time period (e.g., hourly, daily).';

COMMENT ON COLUMN route_metrics.period_start IS
'Start of the time period for this metric aggregation (e.g., start of hour, start of day).';

COMMENT ON COLUMN route_metrics.period_end IS
'End of the time period for this metric aggregation (e.g., end of hour, end of day).';

COMMENT ON COLUMN operation_metrics.period_start IS
'Start of the time period for this metric aggregation (e.g., start of hour, start of day).';

COMMENT ON COLUMN operation_metrics.period_end IS
'End of the time period for this metric aggregation (e.g., end of hour, end of day).';

-- ============================================================================
-- RLS Policies (if needed)
-- ============================================================================

-- Enable RLS
ALTER TABLE route_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_metrics ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role can manage route_metrics"
  ON route_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage operation_metrics"
  ON operation_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read metrics (for admin dashboard)
CREATE POLICY "Authenticated users can read route_metrics"
  ON route_metrics
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read operation_metrics"
  ON operation_metrics
  FOR SELECT
  TO authenticated
  USING (true);
