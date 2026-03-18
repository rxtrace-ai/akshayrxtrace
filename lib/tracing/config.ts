// PHASE-15: OpenTelemetry tracing configuration
// Configures distributed tracing for the application

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

/**
 * PHASE-15: Initialize OpenTelemetry SDK
 * Should be called early in application startup (e.g., in instrumentation.ts or _instrumentation.ts)
 */
export function initializeTracing(): void {
  // Skip if already initialized
  if (sdk) {
    return;
  }

  // Skip if tracing is disabled
  if (process.env.OTEL_TRACES_ENABLED === 'false') {
    return;
  }

  try {
    const serviceName = process.env.OTEL_SERVICE_NAME || 'rxtrace-admin-api';
    const exporterEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const exporterHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS
      ? Object.fromEntries(
          process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((h) => {
            const [key, ...valueParts] = h.split('=');
            return [key.trim(), valueParts.join('=').trim()];
          })
        )
      : undefined;

    // Create trace exporter
    const traceExporter = exporterEndpoint
      ? new OTLPTraceExporter({
          url: exporterEndpoint,
          headers: exporterHeaders,
        })
      : undefined;

    // Create SDK
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      }),
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable fs instrumentation to reduce noise
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
        }),
      ],
    });

    // Start SDK
    sdk.start();

    console.log(`PHASE-15: OpenTelemetry tracing initialized for service: ${serviceName}`);
  } catch (error) {
    console.error('PHASE-15: Failed to initialize OpenTelemetry:', error);
    // Don't throw - tracing is optional
  }
}

/**
 * PHASE-15: Shutdown tracing SDK
 * Should be called during application shutdown
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      sdk = null;
      console.log('PHASE-15: OpenTelemetry tracing shutdown');
    } catch (error) {
      console.error('PHASE-15: Error shutting down tracing:', error);
    }
  }
}
