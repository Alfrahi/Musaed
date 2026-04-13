import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-v8"),
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          "selector": "JSXAttribute[name.name='className'] > Literal[value=/\\b(ml-|mr-|pl-|pr-|left-|right-)/]",
          "message": "Directional CSS classes are forbidden. Use logical properties (ms-*, pe-*, inset-is-*, etc.) for RTL support."
        }
      ]
    }
  }
];

export default eslintConfig;