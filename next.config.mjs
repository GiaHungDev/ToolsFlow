/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: "standalone",
  eslint: {
    // Allows production builds to complete even if ESLint errors are present
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["puppeteer-real-browser"],
  experimental: {
    outputFileTracingIncludes: {
      "/*": ["./src/lib/veo3-extension/**/*", "./node_modules/puppeteer-real-browser/**/*"]
    }
  }
};

export default nextConfig;
