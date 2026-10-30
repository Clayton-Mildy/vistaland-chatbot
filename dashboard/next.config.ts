import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone emits .next/standalone/server.js with only the traced deps, which is what the
  // Docker image ships. No basePath: Caddy serves the dashboard at the site root.
  output: "standalone",
};

export default nextConfig;
