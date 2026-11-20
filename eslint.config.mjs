// @ts-check
/**
 * Hexagonal boundaries are enforced here, not described in a README.
 * A violation is a lint error, which `pnpm verify` and CI both run.
 *
 * The model: src/modules/<name> is a bounded context with three rings —
 * domain (pure), application (use-cases, transactions), adapters (in/out).
 * Modules talk to each other ONLY through <name>/index.ts (the facade).
 */
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

const MODULE = 'src/modules/*';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.tmp/**', 'coverage/**', 'db/migrations/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { boundaries },
    settings: {
      // boundaries resolves import specifiers through eslint-module-utils, whose
      // default node resolver does not know about .ts — without this every
      // relative import is "unknown" and every policy silently matches nothing.
      'import/resolver': { node: { extensions: ['.ts', '.mts', '.tsx', '.js', '.mjs', '.json'] } },
      // 'export' matters as much as 'import': without it a facade can re-export an
      // adapter and the module's public surface becomes its implementation.
      'boundaries/dependency-nodes': ['import', 'export', 'dynamic-import', 'require'],
      // Elements are FOLDERS (v7 semantics — a file pattern here classifies
      // nothing, silently, which `pnpm gate-probes` caught). The two rings that
      // need a per-file distinction — the facade and the Nest wiring, both of
      // which live at the module root — are file CATEGORIES instead.
      'boundaries/elements': [
        { type: 'module-domain', pattern: `${MODULE}/domain`, capture: ['module'] },
        { type: 'module-application', pattern: `${MODULE}/application`, capture: ['module'] },
        { type: 'module-adapter-in', pattern: `${MODULE}/adapters/in`, capture: ['module'] },
        { type: 'module-adapter-out', pattern: `${MODULE}/adapters/out`, capture: ['module'] },
        { type: 'module-root', pattern: MODULE, capture: ['module'] },
        { type: 'platform', pattern: 'src/platform' },
        { type: 'contracts', pattern: 'src/contracts' },
        { type: 'mocks', pattern: 'src/mocks' },
        { type: 'composition', pattern: 'src' },
        { type: 'tooling', pattern: 'scripts' },
      ],
      'boundaries/files': [
        { pattern: `${MODULE}/index.ts`, category: 'facade' },
        { pattern: `${MODULE}/*.module.ts`, category: 'wiring' },
        { pattern: ['**/*.spec.ts', '**/__tests__/**/*', 'src/test/**/*'], category: 'test' },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/dependencies': ['error', {
        default: 'disallow',
        policies: [
          // The domain ring is pure: its own module's domain, and the shared contracts.
          { from: [{ element: { type: 'module-domain' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          // Application orchestrates: its own domain, platform ports, other modules' FACADES.
          { from: [{ element: { type: 'module-application' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-application', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
            { to: { element: { type: 'module-root', captured: { module: '!{{from.module}}' } }, file: { categories: 'facade' } } },
          ] },
          // Adapters see their own module's inner rings, platform, and other facades.
          { from: [{ element: { type: 'module-adapter-in' } }, { element: { type: 'module-adapter-out' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-application', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-adapter-out', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
            { to: { element: { type: 'module-root', captured: { module: '!{{from.module}}' } }, file: { categories: 'facade' } } },
          ] },
          // The facade re-exports its own application and domain types. Nothing else —
          // in particular it may not re-export an adapter, which would turn the public
          // surface of the module into its implementation.
          { from: [{ element: { type: 'module-root' }, file: { categories: 'facade' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-application', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          // Nest wiring is the only place allowed to see all three of its own rings.
          { from: [{ element: { type: 'module-root' }, file: { categories: 'wiring' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-application', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-adapter-in', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-adapter-out', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-root', captured: { module: '!{{from.module}}' } } } },
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          // Platform knows nothing about business modules.
          { from: [{ element: { type: 'platform' } }], allow: [
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          { from: [{ element: { type: 'contracts' } }], allow: [{ to: { element: { type: 'contracts' } } }] },
          // Composition roots wire the modules together; they touch no inner ring.
          { from: [{ element: { type: 'composition' } }], allow: [
            { to: { element: { type: 'module-root' } } },
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          { from: [{ element: { type: 'mocks' } }], allow: [
            { to: { element: { type: 'mocks' } } },
            { to: { element: { type: 'contracts' } } },
            { to: { element: { type: 'platform' } } },
          ] },
          { from: [{ element: { type: 'tooling' } }], allow: [
            { to: { element: { type: 'tooling' } } },
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
            { to: { element: { type: 'module-root' } } },
            { to: { element: { type: 'composition' } } },
          ] },
        ],
      }],
      // Deep imports across modules bypass the facade; ban them by path shape too,
      // so a new element type can never silently open a hole.
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/modules/*/domain/*', '**/modules/*/application/*', '**/modules/*/adapters/**'],
            message: 'Import another module through its index.ts facade (hexagonal boundary).' },
        ],
      }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The domain ring must not know the framework or the database exists.
    files: [`${MODULE}/domain/**/*.ts`],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@nestjs/*', 'drizzle-orm', 'drizzle-orm/*', 'postgres', 'express', 'pino', 'pino-http'],
            message: 'The domain ring stays free of framework and persistence imports.' },
          { group: ['**/modules/*/domain/*', '**/modules/*/application/*', '**/modules/*/adapters/**'],
            message: 'Import another module through its index.ts facade (hexagonal boundary).' },
        ],
      }],
    },
  },
  {
    // Configuration is read in exactly one place, so every knob is documented and typed.
    files: ['src/**/*.ts'],
    ignores: ['src/platform/config/**', 'src/mocks/**'],
    rules: {
      'no-restricted-properties': ['error', {
        object: 'process', property: 'env',
        message: 'Read configuration through platform/config, so every knob is typed and documented.',
      }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/__tests__/**/*.ts', 'src/test/**/*.ts'],
    rules: {
      'boundaries/dependencies': 'off',
      'boundaries/no-unknown-files': 'off',
      'boundaries/no-unknown-dependencies': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-properties': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.ts', '*.mjs', '*.mts'],
    rules: { 'boundaries/no-unknown-files': 'off', 'boundaries/no-unknown-dependencies': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
