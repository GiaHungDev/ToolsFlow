/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // output: "standalone",
  eslint: {
    // Allows production builds to complete even if ESLint errors are present
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
