/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: "standalone",
  eslint: {
    // Allows production builds to complete even if ESLint errors are present
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      "puppeteer-real-browser",
      "otpauth",
      "cloakbrowser",
      "playwright-core",
      "puppeteer-core"
    ],
    outputFileTracingIncludes: {
      "/*": [
        "./src/lib/veo3-extension/**/*",
        "./node_modules/puppeteer-real-browser/**/*",
        "./node_modules/otpauth/**/*",
        "./node_modules/cloakbrowser/**/*",
        "./node_modules/playwright-core/**/*",
        "./node_modules/puppeteer-core/**/*"
      ]
    }
  }
};

export default nextConfig;
