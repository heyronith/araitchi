import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for native better-sqlite3. Disables cacheComponents (incompatible
  // with route segment `runtime = "nodejs"`).
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
