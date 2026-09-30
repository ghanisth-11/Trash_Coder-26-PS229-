import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  // This is a deliberately separate Next.js project inside the backend repository.
  outputFileTracingRoot: path.join(__dirname),
};
export default nextConfig;
