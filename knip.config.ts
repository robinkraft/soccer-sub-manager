import type { KnipConfig } from "knip";

const nextAppEntry = [
  "app/**/{page,layout,route,loading,error,not-found,default,template,global-error}.{ts,tsx}",
  "app/**/route.ts",
];

/** Generated consumer workspace — scopes analysis to apps/web (not prism/). */
const config: KnipConfig = {
  ignoreBinaries: ["vercel"],
  workspaces: {
    "apps/web": {
      entry: [
        ...nextAppEntry,
        "database/drizzle.config.ts",
        "library/**/*.ts",
        "config/**/*.ts",
        "intelligence/tasks/**/*.ts",
        "cli/index.ts",
        "cli/index.js",
      ],
      project: [
        "app/**/*.{ts,tsx}",
        "cli/**/*.{ts,tsx,js}",
        "database/**/*.ts",
        "library/**/*.ts",
        "intelligence/**/*.ts",
        "config/**/*.ts",
        "scripts/**/*.{ts,cjs,mjs}",
        "tests/**/*.{ts,tsx}",
      ],
      ignore: ["../../prism/**"],
      ignoreDependencies: [
        "admin",
        "authentication",
        "charts",
        "database",
        "intelligence",
        "logger",
        "ui",
        "@prism/utilities",
        "@radix-ui/react-slot",
        "feature-flags",
        "flags",
        "lightningcss",
        "tw-animate-css",
        "tailwindcss",
        "postcss-import",
        "postcss-load-config",
      ],
    },
  },
};

export default config;
