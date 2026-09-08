import "@testing-library/jest-dom";

// Setup runs for every test file, including the ones that opt into the `node`
// environment with `// @vitest-environment node` — those have no `window`, and
// nothing to stub.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
