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

// Floating UI asks every ancestor whether it is in the top layer with
// `matches(':popover-open')` and `matches(':modal')`. jsdom's selector engine
// (nwsapi) does not know those pseudo-classes: it recompiles the selector and
// throws on every call, which made a page with a dozen tooltips take ten
// seconds to render. Nothing in jsdom is ever in the top layer.
const nativeMatches = Element.prototype.matches;
Element.prototype.matches = function matches(this: Element, selector: string): boolean {
  if (selector === ':popover-open' || selector === ':modal') return false;
  return nativeMatches.call(this, selector);
};
