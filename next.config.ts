import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pino uses node:async_hooks and worker threads; mark as external so webpack
  // doesn't try to bundle it.
  serverExternalPackages: ["pino", "pino-pretty"],
};

export default nextConfig;
