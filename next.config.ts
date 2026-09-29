import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the Docker image (see Dockerfile) — produces .next/standalone
  // with only the files actually needed to run `node server.js`.
  output: "standalone",
};

export default nextConfig;
