/**
 * Pre-commit hooks (consumer apps/web layout).
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  "apps/web/**/*.{ts,tsx,mjs,js,cjs}": (filenames) => {
    const files = filenames.map((f) => JSON.stringify(f)).join(" ");
    return [
      `prettier --write ${files}`,
      `eslint --config apps/web/eslint.config.mjs --fix --max-warnings 0 ${files}`,
    ];
  },
  "apps/web/**/*.{json,css,md,mdx,yml,yaml}": ["prettier --write"],
  "docs/**/*.{md,mdx}": ["prettier --write"],
};
