/// <reference types="svelte" />
/// <reference types="vite/client" />

/** True in the browser preview (dev server and e2e build), false in the Android build. */
declare const __WEB_PREVIEW__: boolean;

/** package.json version, injected at build time. */
declare const __APP_VERSION__: string;
