import type { NextConfig } from 'next';

const config: NextConfig = {
  // The workspace packages ship TypeScript source rather than a build step,
  // so Next has to compile them alongside the app.
  transpilePackages: ['@vendorlink/core', '@vendorlink/db'],
  serverExternalPackages: ['postgres'],
  eslint: { ignoreDuringBuilds: true },
};

export default config;
