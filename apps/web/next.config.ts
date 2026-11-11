import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["ui", "lucide-react", "gsap"],
  },
  outputFileTracingIncludes: {
    "/*": ["./config.app.json", "./config.prism.json"],
  },
  output: "export",
  // Preview builds serve under /preview/prism/ on GitHub Pages:
  // set PREVIEW_BASE_PATH=/preview/prism in the build env. Root builds
  // leave it unset (empty basePath = serve at /).
  basePath: process.env.PREVIEW_BASE_PATH ?? "",
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    "application-settings",
    "@prism/utilities",
    "charts",
    "logger",
    "ui",
  ],
  turbopack: {},
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@logger": path.resolve(__dirname, "../../prism/packages/logger/source"),
      "@logger/client": path.resolve(
        __dirname,
        "../../prism/packages/logger/source/client"
      ),
      "@logger/server": path.resolve(
        __dirname,
        "../../prism/packages/logger/source/server"
      ),
      "@ui": path.resolve(__dirname, "../../prism/packages/ui/source"),
      "@ui/map": path.resolve(__dirname, "../../prism/packages/ui/source/map.ts"),
      "@ui/pickers": path.resolve(
        __dirname,
        "../../prism/packages/ui/source/pickers.ts"
      ),
      "@utilities": path.resolve(
        __dirname,
        "../../prism/packages/utilities/source"
      ),
    };
    config.resolve.symlinks = true;
    return config;
  },
};

export default nextConfig;
