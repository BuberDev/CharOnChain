import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "contracts/**",
      "packages/contracts/lib/**",
      "packages/contracts/out/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE / docs/05 §7: brak nowych `any` bez uzasadnienia.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Konfiguracje JS nie są typowane.
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Reguły Next.js (a11y, hooks, core web vitals) tylko dla aplikacji Next.
    files: ["apps/web/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}"],
    extends: [...nextVitals],
    settings: { next: { rootDir: ["apps/web/", "apps/admin/"] } },
    rules: {
      // WCAG 2.2 AA (docs/08): brak tekstu alternatywnego jest błędem, nie ostrzeżeniem.
      "jsx-a11y/alt-text": "error",
    },
  },
);
