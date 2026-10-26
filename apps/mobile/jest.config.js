/** Tests de la logique hors ligne (sans React Native). */
module.exports = { preset: 'ts-jest', testEnvironment: 'node', testMatch: ['<rootDir>/src/core/**/*.test.ts'], transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true } }] } };
