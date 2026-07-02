/** @type {import('next').NextConfig} */
const nextConfig = {
  // firebase-admin is server-only; keep it out of client bundles entirely.
  serverExternalPackages: ['firebase-admin'],
};

export default nextConfig;
