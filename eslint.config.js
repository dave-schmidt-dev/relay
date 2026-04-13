// ESLint flat config (v9+)
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript strict rules
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Project-level TypeScript options.
  // projectService discovers tsconfig.json automatically. All src files (including tests)
  // are included in tsconfig.json so eslint can do type-aware linting on every file.
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Rule overrides for this project
  {
    rules: {
      // Permit intentional underscore-prefixed unused vars
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow void returns in callbacks
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },

  // Disable eslint rules that conflict with prettier (must be last)
  prettier,

  // Files to ignore
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "eslint.config.js", "vitest.config.ts"],
  },
);
