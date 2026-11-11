const postcssOklabFunction = require('@csstools/postcss-oklab-function');
const postcssColorMixFunction = require('@csstools/postcss-color-mix-function');

module.exports = {
  plugins: [
    // Transform oklab() and oklch() -> rgb()
    postcssOklabFunction({ preserve: false, subFeatures: { displayP3: false } }),
    // Transform color-mix() -> rgb()
    postcssColorMixFunction({ preserve: false }),
  ],
};
