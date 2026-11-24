/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep `next build` out of the dev server's .next directory.
  // Use NEXT_DIST_DIR=.next-build npm run build when a dev server is running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Agreement surfaces are hand-built; the dev overlay only gets in the way
  // of screenshots and print output.
  devIndicators: false,
  compiler: {
    styledComponents: true,
  },
  transpilePackages: [
    "antd",
    "@ant-design/cssinjs",
    "@ant-design/icons",
    "@ant-design/icons-svg",
    "rc-util",
    "rc-pagination",
    "rc-picker",
    "rc-table",
    "rc-tree",
    "rc-input",
    "rc-select",
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: process.env.NEXT_PUBLIC_APP_WEBSIT_FULL_ADDRESS || '**',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: process.env.NEXT_PUBLIC_APP_WEBSIT_SIMPLE_ADDRESS || '**',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '**',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.r2.dev',
        pathname: '/**',
      },
    ],
  },
  serverExternalPackages: ['@aws-sdk/client-s3'],
};

module.exports = nextConfig;