import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "postcss-import": {
      path: [
        path.join(__dirname, "node_modules"),
        path.join(__dirname, "../../node_modules"),
      ],
    },
    "@tailwindcss/postcss": {},
  },
};

export default config;
