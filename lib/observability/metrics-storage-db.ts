// PHASE-12: Database-backed metrics storage implementation
// Stores metrics in PostgreSQL via Supabase

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { MetricsStorage, TimeRange } from './metrics-storage';
import { RouteMetrics, OperationMetrics } from './metrics';

/**
 * PHASE-12: Get the current hour period (for aggregation)
 */
function getCurrentHourPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  
  return { start, end };
}

/**
 * PHASE-12: Database-backed metrics storage
 * Stores metrics in PostgreSQL with hourly aggregation
 */
export class DatabaseMetricsStorage implements MetricsStorage {
  private getSupabase() {
    return getSupabaseAdmin();
  }

  async recordRouteMetric(
    route: string,
    method: string,
    success: boolean,
    duration: number
  ): Promise<void> {
    try {
      const { start, end } = getCurrentHourPeriod();
      const periodStart = start.toISOString();
      const periodEnd = end.toISOString();
      const now = new Date().toISOString();

      // Try to get existing record for this period
      const { data: existing } = await this.getSupabase()
        .from('route_metrics')
        .select('*')
        .eq('route', route)
        .eq('method', method)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .maybeSingle();

      if (existing) {
        // Update existing record
        const newTotalRequests = existing.total_requests + 1;
        const newSuccessful = success ? existing.successful + 1 : existing.successful;
        const newFailed = success ? existing.failed : existing.failed + 1;
        const newTotalDuration = existing.total_duration_ms + duration;
        const newAverageDuration = newTotalDuration / newTotalRequests;

        await this.getSupabase()
          .from('route_metrics')
          .update({
            total_requests: newTotalRequests,
            successful: newSuccessful,
            failed: newFailed,
            total_duration_ms: newTotalDuration,
            average_duration_ms: newAverageDuration,
            last_request_at: now,
            updated_at: now,
          })
          .eq('id', existing.id);
      } else {
        // Insert new record
        await this.getSupabase()
          .from('route_metrics')
          .insert({
            route,
            method,
            total_requests: 1,
            successful: success ? 1 : 0,
            failed: success ? 0 : 1,
            total_duration_ms: duration,
            average_duration_ms: duration,
            last_request_at: now,
            period_start: periodStart,
            period_end: periodEnd,
          });
      }
    } catch (error) {
      // PHASE-12: Log error but don't throw (graceful degradation)
      console.error('Failed to record route metric to database:', error);
      // In production, you might want to fall back to in-memory storage
    }
  }

  async recordOperationMetric(
    operation: string,
    success: boolean,
    duration: number
  ): Promise<void> {
    try {
      const { start, end } = getCurrentHourPeriod();
      const periodStart = start.toISOString();
      const periodEnd = end.toISOString();
      const now = new Date().toISOString();

      // Try to get existing record for this period
      const { data: existing } = await this.getSupabase()
        .from('operation_metrics')
        .select('*')
        .eq('operation', operation)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .maybeSingle();

      if (existing) {
        // Update existing record
        const newTotalExecutions = existing.total_executions + 1;
        const newSuccessful = success ? existing.successful + 1 : existing.successful;
        const newFailed = success ? existing.failed : existing.failed + 1;
        const newTotalDuration = existing.total_duration_ms + duration;
        const newAverageDuration = newTotalDuration / newTotalExecutions;

        await this.getSupabase()
          .from('operation_metrics')
          .update({
            total_executions: newTotalExecutions,
            successful: newSuccessful,
            failed: newFailed,
            total_duration_ms: newTotalDuration,
            average_duration_ms: newAverageDuration,
            last_execution_at: now,
            updated_at: now,
          })
          .eq('id', existing.id);
      } else {
        // Insert new record
        await this.getSupabase()
          .from('operation_metrics')
          .insert({
            operation,
            total_executions: 1,
            successful: success ? 1 : 0,
            failed: success ? 0 : 1,
            total_duration_ms: duration,
            average_duration_ms: duration,
            last_execution_at: now,
            period_start: periodStart,
            period_end: periodEnd,
          });
      }
    } catch (error) {
      // PHASE-12: Log error but don't throw (graceful degradation)
      console.error('Failed to record operation metric to database:', error);
      // In production, you might want to fall back to in-memory storage
    }
  }

  async getRouteMetrics(
    route?: string,
    method?: string,
    timeRange?: TimeRange
  ): Promise<RouteMetrics[]> {
    try {
      let query = this.getSupabase()
        .from('route_metrics')
        .select('*')
        .order('last_request_at', { ascending: false });

      if (route) {
        query = query.eq('route', route);
      }

      if (method) {
        query = query.eq('method', method);
      }

      if (timeRange) {
        query = query
          .gte('period_start', timeRange.start.toISOString())
          .lte('period_end', timeRange.end.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      // Aggregate metrics across periods if needed
      const aggregated = this.aggregateRouteMetrics(data || []);

      return aggregated.map(rm => ({
        route: rm.route,
        method: rm.method,
        totalRequests: rm.total_requests,
        successful: rm.successful,
        failed: rm.failed,
        averageDuration: Number(rm.average_duration_ms || 0),
        lastRequest: rm.last_request_at,
      }));
    } catch (error) {
      console.error('Failed to get route metrics from database:', error);
      return [];
    }
  }

  async getOperationMetrics(
    operation?: string,
    timeRange?: TimeRange
  ): Promise<OperationMetrics[]> {
    try {
      let query = this.getSupabase()
        .from('operation_metrics')
        .select('*')
        .order('last_execution_at', { ascending: false });

      if (operation) {
        query = query.eq('operation', operation);
      }

      if (timeRange) {
        query = query
          .gte('period_start', timeRange.start.toISOString())
          .lte('period_end', timeRange.end.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      // Aggregate metrics across periods if needed
      const aggregated = this.aggregateOperationMetrics(data || []);

      return aggregated.map(om => ({
        operation: om.operation,
        totalExecutions: om.total_executions,
        successful: om.successful,
        failed: om.failed,
        averageDuration: Number(om.average_duration_ms || 0),
        lastExecution: om.last_execution_at,
      }));
    } catch (error) {
      console.error('Failed to get operation metrics from database:', error);
      return [];
    }
  }

  async getMetricsSummary(): Promise<{
    totalRoutes: number;
    totalOperations: number;
    totalRouteRequests: number;
    totalOperationExecutions: number;
  }> {
    try {
      // Get current hour period
      const { start, end } = getCurrentHourPeriod();

      // Get route metrics for current period
      const { data: routeData, error: routeError } = await this.getSupabase()
        .from('route_metrics')
        .select('total_requests')
        .gte('period_start', start.toISOString())
        .lte('period_end', end.toISOString());

      if (routeError) throw routeError;

      // Get operation metrics for current period
      const { data: opData, error: opError } = await this.getSupabase()
        .from('operation_metrics')
        .select('total_executions')
        .gte('period_start', start.toISOString())
        .lte('period_end', end.toISOString());

      if (opError) throw opError;

      // Count unique routes and operations
      const uniqueRoutes = new Set(
        (routeData || []).map((r: any) => `${r.route}:${r.method}`)
      );
      const uniqueOperations = new Set(
        (opData || []).map((o: any) => o.operation)
      );

      return {
        totalRoutes: uniqueRoutes.size,
        totalOperations: uniqueOperations.size,
        totalRouteRequests: (routeData || []).reduce(
          (sum: number, r: any) => sum + (r.total_requests || 0),
          0
        ),
        totalOperationExecutions: (opData || []).reduce(
          (sum: number, o: any) => sum + (o.total_executions || 0),
          0
        ),
      };
    } catch (error) {
      console.error('Failed to get metrics summary from database:', error);
      return {
        totalRoutes: 0,
        totalOperations: 0,
        totalRouteRequests: 0,
        totalOperationExecutions: 0,
      };
    }
  }

  async resetMetrics(): Promise<void> {
    try {
      const supabase = this.getSupabase();
      await supabase.from('route_metrics').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('operation_metrics').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } catch (error) {
      console.error('Failed to reset metrics in database:', error);
      throw error;
    }
  }

  /**
   * PHASE-12: Aggregate route metrics across multiple periods
   */
  private aggregateRouteMetrics(records: any[]): any[] {
    const aggregated = new Map<string, any>();

    for (const record of records) {
      const key = `${record.route}:${record.method}`;
      const existing = aggregated.get(key);

      if (existing) {
        existing.total_requests += record.total_requests || 0;
        existing.successful += record.successful || 0;
        existing.failed += record.failed || 0;
        existing.total_duration_ms += record.total_duration_ms || 0;
        
        // Update average duration
        if (existing.total_requests > 0) {
          existing.average_duration_ms = existing.total_duration_ms / existing.total_requests;
        }

        // Keep most recent last_request_at
        if (record.last_request_at && (!existing.last_request_at || 
            new Date(record.last_request_at) > new Date(existing.last_request_at))) {
          existing.last_request_at = record.last_request_at;
        }
      } else {
        aggregated.set(key, { ...record });
      }
    }

    return Array.from(aggregated.values());
  }

  /**
   * PHASE-12: Aggregate operation metrics across multiple periods
   */
  private aggregateOperationMetrics(records: any[]): any[] {
    const aggregated = new Map<string, any>();

    for (const record of records) {
      const key = record.operation;
      const existing = aggregated.get(key);

      if (existing) {
        existing.total_executions += record.total_executions || 0;
        existing.successful += record.successful || 0;
        existing.failed += record.failed || 0;
        existing.total_duration_ms += record.total_duration_ms || 0;
        
        // Update average duration
        if (existing.total_executions > 0) {
          existing.average_duration_ms = existing.total_duration_ms / existing.total_executions;
        }

        // Keep most recent last_execution_at
        if (record.last_execution_at && (!existing.last_execution_at || 
            new Date(record.last_execution_at) > new Date(existing.last_execution_at))) {
          existing.last_execution_at = record.last_execution_at;
        }
      } else {
        aggregated.set(key, { ...record });
      }
    }

    return Array.from(aggregated.values());
  }
}
