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
      'boundaries/dependency-nodes': ['import', 'dynamic-import', 'require'],
      'boundaries/elements': [
        { type: 'module-domain', pattern: `${MODULE}/domain/**/*`, capture: ['_', 'module'], partialMatch: false },
        { type: 'module-application', pattern: `${MODULE}/application/**/*`, capture: ['_', 'module'], partialMatch: false },
        { type: 'module-adapter-in', pattern: `${MODULE}/adapters/in/**/*`, capture: ['_', 'module'], partialMatch: false },
        { type: 'module-adapter-out', pattern: `${MODULE}/adapters/out/**/*`, capture: ['_', 'module'], partialMatch: false },
        { type: 'module-facade', pattern: `${MODULE}/index.ts`, capture: ['_', 'module'], partialMatch: false },
        { type: 'module-wiring', pattern: `${MODULE}/*.module.ts`, capture: ['_', 'module'], partialMatch: false },
        { type: 'platform', pattern: 'src/platform/**/*', partialMatch: false },
        { type: 'contracts', pattern: 'src/contracts/**/*', partialMatch: false },
        { type: 'mocks', pattern: 'src/mocks/**/*', partialMatch: false },
        { type: 'composition', pattern: 'src/*.ts', partialMatch: false },
        { type: 'tooling', pattern: ['scripts/**/*', 'vitest.config.mts', 'drizzle.config.ts'], partialMatch: false },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/dependencies': ['error', {
        default: 'disallow',
        policies: [
          // Domain is pure: its own module's domain and the contracts, nothing else.
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
            { to: { element: { type: 'module-facade', captured: { module: '!{{from.module}}' } } } },
          ] },
          // Adapters may see everything inside their own module, plus platform.
          { from: [{ element: { type: 'module-adapter-in' } }, { element: { type: 'module-adapter-out' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-application', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-adapter-out', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
            { to: { element: { type: 'module-facade', captured: { module: '!{{from.module}}' } } } },
          ] },
          // The facade re-exports its own application + domain types. Nothing else.
          { from: [{ element: { type: 'module-facade' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-application', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          // Wiring (the Nest module) is the only place allowed to see all three rings.
          { from: [{ element: { type: 'module-wiring' } }], allow: [
            { to: { element: { type: 'module-domain', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-application', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-adapter-in', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-adapter-out', captured: { module: '{{from.module}}' } } } },
            { to: { element: { type: 'module-facade', captured: { module: '!{{from.module}}' } } } },
            { to: { element: { type: 'module-wiring', captured: { module: '!{{from.module}}' } } } },
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          // Platform knows nothing about business modules.
          { from: [{ element: { type: 'platform' } }], allow: [
            { to: { element: { type: 'platform' } } },
            { to: { element: { type: 'contracts' } } },
          ] },
          { from: [{ element: { type: 'contracts' } }], allow: [{ to: { element: { type: 'contracts' } } }] },
          // Composition roots wire everything together.
          { from: [{ element: { type: 'composition' } }], allow: [
            { to: { element: { type: 'module-wiring' } } },
            { to: { element: { type: 'module-facade' } } },
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
            { to: { element: { type: 'module-facade' } } },
            { to: { element: { type: 'module-wiring' } } },
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
    files: ['**/*.spec.ts', '**/__tests__/**/*.ts'],
    rules: {
      'boundaries/dependencies': 'off',
      'boundaries/no-unknown-files': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-properties': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.ts', '*.mjs', '*.mts'],
    rules: { 'boundaries/no-unknown-files': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
