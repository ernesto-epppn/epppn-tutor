import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse relies on Node-specific PDF.js/canvas assets. Keep them outside
  // the Turbopack server bundle so PDF imports work in Vercel functions.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],

  async rewrites() {
    return {
      beforeFiles: [
        // Keep the existing UI reference but serve the approved Ernesto image.
        { source: "/logo-ernesto.png", destination: "/logo-ernesto-approved.png" },
        // Serve the same approved Ernesto image as the site favicon.
        { source: "/favicon.ico", destination: "/favicon-ernesto-approved.png" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
