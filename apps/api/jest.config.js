module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.e2e.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
  testTimeout: 60000,
  setupFiles: ['<rootDir>/test/env.ts'],
};
