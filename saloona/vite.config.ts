import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Content Security Policy.
 * The Android build (mode "production") gets the strict policy. The web preview
 * used for development and end-to-end tests runs the database in sql.js
 * (WebAssembly), which needs 'wasm-unsafe-eval'. That build never ships in the APK.
 */
function csp(webPreview: boolean): string {
  const script = webPreview ? "'self' 'wasm-unsafe-eval'" : "'self'";
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function cspPlugin(webPreview: boolean, dev: boolean): Plugin {
  return {
    name: 'saloona-csp',
    transformIndexHtml(html) {
      // Vite's dev server injects inline scripts for HMR, so the meta tag is only
      // added to built output. The dev server is never used on a phone.
      const value = dev ? '' : csp(webPreview);
      const tag = value
        ? `<meta http-equiv="Content-Security-Policy" content="${value}">`
        : '';
      return html.replace('<!--CSP-->', tag);
    }
  };
}

export default defineConfig(({ mode, command }) => {
  const webPreview = mode !== 'production';
  return {
    base: './',
    plugins: [svelte(), cspPlugin(webPreview, command === 'serve')],
    define: {
      __WEB_PREVIEW__: JSON.stringify(webPreview),
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    build: {
      target: 'es2022',
      assetsInlineLimit: 0,
      sourcemap: false,
      modulePreload: { polyfill: false },
      outDir: webPreview ? 'dist-web' : 'dist',
      emptyOutDir: true
    },
    test: {
      include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
      environment: 'node',
      coverage: {
        include: ['src/domain/**', 'src/data/**'],
        exclude: ['**/*.test.ts', 'src/data/native.ts']
      }
    }
  };
});
