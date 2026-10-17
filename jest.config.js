/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@elemental/asset-schema$': '<rootDir>/packages/asset-schema/src/index.ts',
    '^@elemental/animation-core$': '<rootDir>/packages/animation-core/src/index.ts',
    '^@elemental/animation-runtime$': '<rootDir>/packages/animation-runtime/src/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/react-native-skia)',
  ],
  collectCoverageFrom: ['packages/**/src/**/*.ts', 'src/engine/**/*.ts', 'src/state/**/*.ts'],
};
