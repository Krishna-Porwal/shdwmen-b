import { globalTeardown } from './globalTeardown';

jest.useRealTimers();

afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

afterAll(async () => {
  await globalTeardown();
});
