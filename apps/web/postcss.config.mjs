/**
 * Tailwind v4 is a PostCSS plugin; there is no tailwind.config.js.
 * The design tokens live in packages/ui/src/styles/globals.css.
 */
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
