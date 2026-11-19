import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@napi-rs/canvas"],
  devIndicators: false,
  poweredByHeader: false,
};
export default config;
