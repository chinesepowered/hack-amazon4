import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Strands SDK dynamically imports optional AWS clients; keep it out of the Turbopack bundle.
  serverExternalPackages: ["@strands-agents/sdk"],
};

export default nextConfig;
