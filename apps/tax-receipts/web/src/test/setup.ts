import '@testing-library/jest-dom/vitest';

// jsdom lacks ResizeObserver, which Mantine's floating-position components
// (Menu, Select, ...) use via Floating UI.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});

// jsdom lacks scrollIntoView, which Mantine's Combobox (Select, ...) calls
// when scrolling the active option into view.
Element.prototype.scrollIntoView = () => {};

// jsdom lacks matchMedia, which Mantine's color-scheme hook uses.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
