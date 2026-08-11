import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse relies on Node-specific PDF.js assets. Keep it outside the
  // Turbopack server bundle and load it only for authenticated PDF imports.
  serverExternalPackages: ["pdf-parse"],

  async rewrites() {
    return {
      beforeFiles: [
        // Keep the existing UI reference but serve the new Ernesto identity.
        { source: "/logo-ernesto.png", destination: "/logo-ernesto-new.svg" },
        // Replace the legacy favicon without touching the old binary .ico file.
        { source: "/favicon.ico", destination: "/favicon-ernesto.svg" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
