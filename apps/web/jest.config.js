// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextJest = require('next/jest')

// Providing the path to your Next.js app allows loading next.config.js and .env files.
const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
}

// createJestConfig is exported this way to ensure next/jest can load the Next.js config, which is async
module.exports = createJestConfig(customJestConfig)
