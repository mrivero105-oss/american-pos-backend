import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof window !== 'undefined') {
    if (!window.matchMedia) {
        window.matchMedia = (query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        });
    }

    if (!window.ResizeObserver) {
        window.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }

    if (!window.IntersectionObserver) {
        window.IntersectionObserver = class IntersectionObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }

    if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = () => {};
    }
}

afterEach(() => {
    cleanup();
});
