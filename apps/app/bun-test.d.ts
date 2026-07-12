/**
 * Ambient type declarations for `bun:test`.
 *
 * Mirrors the small subset of the bun:test API we use across the
 * app. We don't import the full `bun-types` package because doing
 * so overrides the DOM `fetch` type (which would break a lot of
 * unrelated code). Keeping this file scoped + minimal avoids that
 * ripple.
 *
 * When you need a new bun:test helper, add it here.
 */
declare module "bun:test" {
  export const describe: (name: string, fn: () => void | Promise<void>) => void;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const beforeAll: (fn: () => void | Promise<void>) => void;
  export const afterAll: (fn: () => void | Promise<void>) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export interface Expect {
    <T>(actual: T): {
      toBe: (expected: unknown) => void;
      toEqual: (expected: unknown) => void;
      toMatch: (expected: RegExp | string) => void;
      toContain: (expected: unknown) => void;
      toBeGreaterThan: (expected: number) => void;
      toBeGreaterThanOrEqual: (expected: number) => void;
      toBeLessThan: (expected: number) => void;
      toBeLessThanOrEqual: (expected: number) => void;
      toBeTruthy: () => void;
      toBeFalsy: () => void;
      toBeNull: () => void;
      toBeUndefined: () => void;
      toBeDefined: () => void;
      toHaveLength: (expected: number) => void;
      toThrow: (expected?: string | RegExp) => void;
      toHaveBeenCalled: () => void;
      toHaveBeenCalledTimes: (n: number) => void;
      not: Expect;
    };
  }
  export const expect: Expect;

  export interface Mock<TArgs extends unknown[] = unknown[], TReturn = unknown> {
    (...args: TArgs): TReturn;
    mockReturnValue: (value: TReturn) => Mock<TArgs, TReturn>;
    mockReturnValueOnce: (value: TReturn) => Mock<TArgs, TReturn>;
    mockResolvedValue: (value: TReturn | Promise<TReturn>) => Mock<TArgs, TReturn>;
    mockResolvedValueOnce: (value: TReturn | Promise<TReturn>) => Mock<TArgs, TReturn>;
    mockRejectedValue: (err: unknown) => Mock<TArgs, TReturn>;
    mockRejectedValueOnce: (err: unknown) => Mock<TArgs, TReturn>;
    mockImplementation: (fn: (...args: TArgs) => TReturn) => Mock<TArgs, TReturn>;
    mockImplementationOnce: (fn: (...args: TArgs) => TReturn) => Mock<TArgs, TReturn>;
    mockReset: () => void;
    mockClear: () => void;
    mockRestore: () => void;
    mock: {
      calls: TArgs[];
      results: Array<{ type: "return" | "throw"; value: TReturn | unknown }>;
    };
  }
  export const vi: {
    <TArgs extends unknown[] = unknown[], TReturn = unknown>(
      fn?: (...args: TArgs) => TReturn,
    ): Mock<TArgs, TReturn>;
    fn: <TArgs extends unknown[] = unknown[], TReturn = unknown>(
      fn?: (...args: TArgs) => TReturn,
    ) => Mock<TArgs, TReturn>;
    spyOn: <T extends object, K extends keyof T>(obj: T, method: K) => Mock;
  };
}
