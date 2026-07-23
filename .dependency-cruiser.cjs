/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolved',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'domain-no-outward-dependencies',
      severity: 'error',
      from: { path: '(^|/)src/domain/' },
      to: {
        path: '(^|/)src/(adapters|application|composition|core|game|features|categories|historical)/',
      },
    },
    {
      name: 'core-no-external-or-feature-dependencies',
      severity: 'error',
      from: { path: '(^|/)src/core/' },
      to: {
        path: '(^|/)src/(adapters|application|composition|game|features|categories|historical)/',
      },
    },
    {
      name: 'game-no-feature-dependencies',
      severity: 'error',
      from: { path: '(^|/)src/game/' },
      to: { path: '(^|/)src/features/' },
    },
    {
      name: 'categories-no-feature-internals',
      severity: 'error',
      from: { path: '(^|/)src/categories/' },
      to: { path: '(^|/)src/features/[^/]+/(?!index\\.ts$)' },
    },
    {
      name: 'historical-no-active-features',
      severity: 'error',
      from: { path: '(^|/)src/historical/' },
      to: { path: '(^|/)src/features/' },
    },
    {
      name: 'features-no-provider-adapters',
      severity: 'error',
      from: { path: '(^|/)src/features/' },
      to: { path: '(^|/)src/adapters/providers/' },
    },
  ],
  options: {
    doNotFollow: 'node_modules',
    exclude: '(^|/)node_modules/',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};
