// eslint.config.mjs — Musaed v3 Enforcement Layer
// Flat config (ESLint 9+). Rules are partitioned by concern:
//   ESLint        → code quality, TypeScript strictness, React/Next best practices
//   dep-cruiser   → architecture boundaries, feature isolation, import graph
//   Husky         → local guardrail orchestration
//   CI            → full validation gate

import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactPlugin from 'eslint-plugin-react';

// ── Local plugin: a11y focus affordance rules (STANDARDS.md §13) ──────────
const a11yFocusPlugin = {
  rules: {
    // reason: banning `focus:outline-none` without an adjacent `focus-visible:ring-*` keeps the global `:focus-visible` outline (globals.css) from being silently stripped
    'no-focus-outline-none-without-ring': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow `focus:outline-none` on focusable elements without an adjacent `focus-visible:ring-*` (STANDARDS.md §13).',
        },
        schema: [],
        messages: {
          missingRing:
            '`focus:outline-none` strips the keyboard focus affordance. Pair it with `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background` (or an equivalent `focus-visible:ring-*`), per STANDARDS.md §13.',
        },
      },
      create(context) {
        const FOCUS_OUTLINE_NONE_RE = /(^|\s)focus:outline-none(\s|$)/;
        const FOCUS_VISIBLE_RING_RE = /(^|\s)focus-visible:ring-[^\s]+(\s|$)/;
        const checkClassString = (node, raw) => {
          if (typeof raw !== 'string') return;
          if (!FOCUS_OUTLINE_NONE_RE.test(raw)) return;
          if (FOCUS_VISIBLE_RING_RE.test(raw)) return;
          context.report({ node, messageId: 'missingRing' });
        };

        return {
          JSXAttribute(node) {
            if (node.name?.name !== 'className') return;
            const value = node.value;
            if (!value) return;

            // Form: className="..."
            if (value.type === 'Literal' && typeof value.value === 'string') {
              checkClassString(value, value.value);
              return;
            }

            // Form: className={`...`} (template literal with quasis)
            if (
              value.type === 'JSXExpressionContainer' &&
              value.expression?.type === 'TemplateLiteral'
            ) {
              for (const quasi of value.expression.quasis) {
                checkClassString(quasi, quasi.value?.raw);
              }
              return;
            }
          },
        };
      },
    },
  },
};

// ── Local plugin: Button primitive adoption rule (STANDARDS.md §13/§17) ───
// `Button` from `@/components/ui/button` carries the focus-visible ring, default
// `type="button"`, ref-forwarding, and the CVA variant contract. Allowing raw
// `<button>` lets these affordances silently drift back out of the chat/compose
// surface and modal footers.
// This rule warns (not errors) so the remaining sweep doesn't gate Phase 1; the
// standard expects the lint warning to be live, not the migration to be complete.
const buttonAdoptionPlugin = {
  rules: {
    // reason: warns on raw `<button>` JSX in `.tsx` files that don't `import { Button } from '@/components/ui/button'`. Warning-level (not error) so the Phase 1 sweep is not blocked.
    'prefer-button-primitive': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Prefer importing `Button` from `@/components/ui/button` over using a raw `<button>` JSX element (STANDARDS.md §13/§17).',
        },
        schema: [],
        messages: {
          preferPrimitive:
            'Raw `<button>` detected. Import `Button` from `@/components/ui/button` and use the appropriate `variant` / `size` to inherit the focus-visible ring, default `type="button"`, and CVA variant contract.',
        },
      },
      create(context) {
        const filename = context.filename ?? '';
        // Only enforce inside the web app's TSX sources. Test files, config,
        // and the Button primitive itself are exempt — a Button test that
        // renders raw `<button>` for comparison is legitimate, and `button.tsx`
        // is the one file that must use a raw `<button>`.
        if (
          !filename.includes('/apps/web/src/') ||
          !filename.endsWith('.tsx') ||
          filename.endsWith('.test.tsx') ||
          filename.endsWith('/components/ui/button.tsx')
        ) {
          // Returning an empty visitor is the documented way for `create` to
          // opt out of a file without tripping ESLint's "did not return an
          // object" guard.
          return {};
        }

        let importsButton = false;
        return {
          ImportDeclaration(node) {
            const src = node.source?.value ?? '';
            if (src === '@/components/ui/button' || src.endsWith('/components/ui/button')) {
              importsButton = true;
            }
          },
          JSXOpeningElement(node) {
            if (importsButton) return;
            const name = node.name;
            if (name?.type === 'JSXIdentifier' && name.name === 'button') {
              context.report({ node, messageId: 'preferPrimitive' });
            }
          },
        };
      },
    },
  },
};

// ── Local plugin: caption typography rule (STANDARDS.md §13 — WCAG 1.4.3) ──
// Banning raw `text-[Npx]` numeric font-sizes for N ≤ 11 keeps micro-labels on
// the shared `caption-xs` (12px) / `caption-md` (13px) utilities defined in
// globals.css. Those utilities carry the zinc-600/700 · dark zinc-300/200 pair
// that meets WCAG 1.4.3, so ad-hoc sub-12px sizes that would silently regress
// the contrast at small typesizes are caught by CI.
//
// No file is exempted. The rule fires unconditionally across `apps/web/src`,
// including `components/ui/button.tsx` (which now uses Tailwind's stock
// `text-xs` / `text-sm` utilities — color-neutral sizes — rather than the
// color-opinionated `caption-*` utilities that would clobber its variant color)
// and test files (which must not regress to sub-12px fixtures either).
const captionTypographyPlugin = {
  rules: {
    // reason: bans `text-[<int>px]` / `text-[<int>.<int>px]` with size ≤ 11px in JSX className strings. Forces sub-12px micro-labels onto `caption-xs` (12px) / `caption-md` (13px) which carry WCAG-1.4.3-safe colors. The rule fires on every `.ts`/`.tsx` parsed by ESLint under `apps/web/src` — no carve-outs.
    'no-sub-12px-typography': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow `text-[<N>px]` Tailwind arbitrary font-size utilities with N ≤ 11 in JSX className strings — use `caption-xs` (12px) or `caption-md` (13px) instead (STANDARDS.md §13 — WCAG 1.4.3).',
        },
        schema: [],
        messages: {
          tooSmall:
            '`text-[{{value}}]` is below the 12px minimum body-readable typesize. Use the `caption-xs` (12px) or `caption-md` (13px) utility from `apps/web/src/app/globals.css` instead so the label inherits the WCAG-1.4.3-safe zinc shade (STANDARDS.md §13).',
        },
      },
      create(context) {
        const SMALL_FONT_RE = /(^|\s)text-\[(\d+(?:\.\d+)?)px\](\s|$)/g;
        const checkClassString = (node, raw) => {
          if (typeof raw !== 'string') return;
          // Reset lastIndex because `g` flag is stateful across calls.
          SMALL_FONT_RE.lastIndex = 0;
          let m;
          while ((m = SMALL_FONT_RE.exec(raw)) !== null) {
            const value = parseFloat(m[2]);
            if (Number.isFinite(value) && value <= 11) {
              context.report({ node, messageId: 'tooSmall', data: { value: `${m[2]}px` } });
            }
          }
        };

        return {
          JSXAttribute(node) {
            if (node.name?.name !== 'className') return;
            const value = node.value;
            if (!value) return;

            if (value.type === 'Literal' && typeof value.value === 'string') {
              checkClassString(value, value.value);
              return;
            }
            if (
              value.type === 'JSXExpressionContainer' &&
              value.expression?.type === 'TemplateLiteral'
            ) {
              for (const quasi of value.expression.quasis) {
                checkClassString(quasi, quasi.value?.raw);
              }
              return;
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      'src-tauri/**',
      'demo/**',
    ],
  },

  // ── Base: TypeScript recommended ─────────────────────────
  ...tseslint.configs.recommended,

  // ── Main config ─────────────────────────────────────────
  {
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
      react: reactPlugin,
      'musaed-a11y-focus': a11yFocusPlugin,
      'musaed-buttons': buttonAdoptionPlugin,
      'musaed-typography': captionTypographyPlugin,
    },

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          './apps/web/tsconfig.json',
          './packages/contracts/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },

    settings: {
      react: { version: 'detect' },
      next: { rootDir: ['apps/web/'] },
    },

    rules: {
      // ================================================
      // NEXT + REACT
      // ================================================
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,

      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      'react/function-component-definition': [
        'error',
        { namedComponents: 'arrow-function' },
      ],

      // Next.js App Router — no pages/ directory
      '@next/next/no-html-link-for-pages': 'off',

      // ================================================
      // TYPESCRIPT STRICTNESS
      // ================================================
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',

      // ================================================
      // MUSAED RUNTIME ENFORCEMENT (no-restricted-syntax)
      // Architecture boundary rules live in .dependency-cruiser.js
      // ================================================
      'no-restricted-syntax': [
        'error',

        // SSR FORBIDDEN — Musaed is static-export only
        {
          selector:
            "ExportNamedDeclaration[declaration.declarations.0.id.name='getServerSideProps']",
          message: 'Musaed is fully static. getServerSideProps is forbidden.',
        },
        {
          selector:
            "ExportNamedDeclaration[declaration.declarations.0.id.name='getStaticProps']",
          message: 'Musaed uses static export. getStaticProps is forbidden — use client-side data fetching.',
        },

        // RAW IPC FORBIDDEN — must use src/lib/ipc.ts
        {
          selector: "CallExpression[callee.name='invoke']",
          message: 'Direct invoke() is forbidden. Use src/lib/ipc.ts only.',
        },

        // WINDOW.__TAURI__ GLOBAL FORBIDDEN
        {
          selector: "MemberExpression[object.name='window'][property.name='__TAURI__']",
          message: 'Direct window.__TAURI__ access is forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // WINDOW.__TAURI_INTERNALS__ GLOBAL FORBIDDEN
        {
          selector: "MemberExpression[object.name='window'][property.name='__TAURI_INTERNALS__']",
          message: 'Direct window.__TAURI_INTERNALS__ access is forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // DIRECT TAURI API FORBIDDEN
        {
          selector: "ImportDeclaration[source.value=/^@tauri-apps\\/api/]",
          message: 'Direct Tauri API usage forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // DIRECT TAURI PLUGIN FORBIDDEN
        {
          selector: "ImportDeclaration[source.value=/^@tauri-apps\\/plugin-/]",
          message: 'Direct Tauri plugin usage forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // AI TOOLING DRIFT PREVENTION
        {
          selector:
            "Literal[value=/.*(webpack|vite|rollup|esbuild|turbo).*config.*/i]",
          message: 'Do not introduce new tooling/configs without explicit approval.',
        },

        // PROCESS.ENV ABSTRACTION
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Use typed configuration layer instead of process.env directly.',
        },

        // MUSAED i18n HARD RULE — no hardcoded toast messages (STANDARDS.md §11/§13).
        // Toast calls must resolve message strings via `t()` (from useTranslation in
        // components/hooks) or `translate()` (from lib/i18n, for module-scoped code
        // like lib/ipc.ts and event handler modules). String literals, template
        // literals, and `x || 'literal'`-style fallbacks as the first argument are
        // forbidden — Arabic users would otherwise see raw English on the most
        {
          selector:
            "CallExpression[callee.object.name='toast'][arguments.0.type='Literal']",
          message:
            'Toast messages must be localized via t()/translate() — hardcoded string literals are forbidden (STANDARDS.md §11/§13).',
        },
        {
          selector:
            "CallExpression[callee.object.name='toast'][arguments.0.type='TemplateLiteral']",
          message:
            'Toast messages must be localized via t()/translate() — hardcoded template literals are forbidden (STANDARDS.md §11/§13).',
        },
        {
          selector:
            "CallExpression[callee.object.name='toast'][arguments.0.type='LogicalExpression'][arguments.0.right.type='Literal']",
          message:
            'Toast fallback strings must be localized via t()/translate() — `x || \'literal\'` is forbidden (STANDARDS.md §11/§13).',
        },
      ],

      // ================================================
      // COMPLEXITY & CODE QUALITY
      // ================================================
      'max-lines-per-function': [
        'error',
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      'prefer-const': 'error',
      'no-else-return': 'error',
      'no-useless-return': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // ================================================
      // MUSAED-SPECIFIC
      // ================================================
      'no-restricted-properties': [
        'error',
        {
          object: 'console',
          property: 'log',
          message: 'Use structured logger (src/lib/logger.ts).',
        },
      ],

      // reason: flags `focus:outline-none` without adjacent `focus-visible:ring-*` (globals.css `:focus-visible` requires component suppression not to strip keyboard affordance)
      'musaed-a11y-focus/no-focus-outline-none-without-ring': 'error',

      // reason: warns on raw `<button>` in `.tsx` files that don't import `Button` from `@/components/ui/button`. Warning-level so the Phase 1 sweep doesn't block; the contract is enforced as new code opts in.
      'musaed-buttons/prefer-button-primitive': 'warn',

      // reason: errors on `text-[Npx]` Tailwind arbitrary font-sizes with N ≤ 11px in JSX className strings. Forces micro-labels onto the shared `caption-xs` (12px) / `caption-md` (13px) utilities from globals.css that carry WCAG-1.4.3-safe zinc shades. The rule fires unconditionally on every file ESLint parses under `apps/web/src` — including `button.tsx` (now migrated off `text-[10px]`) and tests — with no carve-outs at the rule level.
      'musaed-typography/no-sub-12px-typography': 'error',
    },
  },

  // ── IPC layer exceptions ─────────────────────────────────
  // lib/ipc.ts and lib/tauri-storage.ts are the only files allowed to use the raw
  // @tauri-apps/* APIs and process.env — so `no-restricted-syntax` is narrowed here
  // to JUST the i18n toast-literal guard, rather than disabled entirely. This closes
  // a trap: an unconstrained blanket `'off'` would let raw English
  // toast strings drift back into the IPC bridge — exactly the area being targeted —
  // and the rule would never fire on the file it's most needed for.
  {
    files: [
      'apps/web/src/lib/ipc.ts',
      'apps/web/src/lib/tauri-storage.ts',
      'apps/web/src/lib/tauri-plugins.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='toast'][arguments.0.type='Literal']",
          message:
            'Toast messages must be localized via t()/translate() — hardcoded string literals are forbidden (STANDARDS.md §11/§13).',
        },
        {
          selector:
            "CallExpression[callee.object.name='toast'][arguments.0.type='TemplateLiteral']",
          message:
            'Toast messages must be localized via t()/translate() — hardcoded template literals are forbidden (STANDARDS.md §11/§13).',
        },
        {
          selector:
            "CallExpression[callee.object.name='toast'][arguments.0.type='LogicalExpression'][arguments.0.right.type='Literal']",
          message:
            'Toast fallback strings must be localized via t()/translate() — `x || \'literal\'` is forbidden (STANDARDS.md §11/§13).',
        },
      ],
      'no-restricted-imports': 'off',
    },
  },

  // ── Test file exceptions ─────────────────────────────────
  {
    files: [
      '**/*.{test,spec}.ts',
      '**/*.{test,spec}.tsx',
      'apps/web/src/tests/**/*',
      'apps/web/src/__mocks__/**/*',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'max-lines-per-function': 'off',
      'no-restricted-properties': 'off',
      'no-console': 'off',
    },
  },

  // ── Config/JS file exceptions ────────────────────────────
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
    },
    languageOptions: { parserOptions: { project: null } },
  },

  // ── Vitest config exception ──────────────────────────────
  {
    files: ['**/vitest*.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ── Playwright config exception ─────────────────────────
  {
    files: ['**/playwright*.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ── Config layer exception ──────────────────────────────
  {
    files: ['apps/web/src/lib/config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
