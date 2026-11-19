import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@napi-rs/canvas","@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/inngest": ["./node_modules/@ffmpeg-installer/*/ffmpeg", "./node_modules/@ffmpeg-installer/*/ffmpeg.exe"],
  },
  devIndicators: false,
  poweredByHeader: false,
};
export default config;
