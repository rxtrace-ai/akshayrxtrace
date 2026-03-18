/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use a custom build output directory to avoid locked .next artifacts on Windows hosts.
  distDir: ".next-build",
  // Optimize fonts but allow fallback if fetch fails
  optimizeFonts: true,
  // Skip font optimization if network fails (will use system fonts)
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Production security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  // R3: TypeScript/ESLint - kept disabled for Windows EPERM; run `npx tsc --noEmit` and `npm run lint` in CI
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Reduce parallel workers to avoid EPERM on Windows
  webpack: (config, { dev, isServer }) => {
    // Use single worker on Windows to avoid spawn EPERM
    if (process.platform === 'win32') {
      config.parallelism = 1;
    }
    return config;
  },
}

// Apply Sentry only when not building (skip during next build to avoid hang/slow source map uploads)
const { withSentryConfig } = require("@sentry/nextjs");
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
const skipSentry = process.env.SENTRY_IGNORE_BUILD === "1" || isProductionBuild;

const config = skipSentry
  ? nextConfig
  : withSentryConfig(nextConfig, {
      org: "rxtrace-india",
      project: "javascript-nextjs",
      silent: !process.env.CI,
      widenClientFileUpload: true,
      webpack: {
        automaticVercelMonitors: true,
        treeshake: { removeDebugLogging: true },
      },
    });

module.exports = config;
