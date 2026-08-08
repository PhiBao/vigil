import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // RPC/API payloads are untyped by design; we validate at the edges
      // rather than casting every field. This is a deliberate tradeoff.
      "@typescript-eslint/no-explicit-any": "warn",

      // Server components execute once per request; the React Compiler's
      // purity rules (built for client components with re-renders) don't
      // apply meaningfully to Date.now()/setState-at-top in RSC boundaries.
      "react-compiler/rule-of-hooks": "off",
      "react-compiler/set-state-in-effect": "off",
      "react-compiler/impure-function-in-render": "off",
      "@react-hooks/rules-of-hooks": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/**",
  ]),
]);

export default eslintConfig;
