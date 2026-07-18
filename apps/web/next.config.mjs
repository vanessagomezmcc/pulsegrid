/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pulsegrid/config', '@pulsegrid/shared-types', '@pulsegrid/ui'],
  reactStrictMode: true,
};
export default nextConfig;
