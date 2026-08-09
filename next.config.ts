import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse relies on Node-specific PDF.js assets. Keep it outside the
  // Turbopack server bundle and load it only for authenticated PDF imports.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
