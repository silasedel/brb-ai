import type { Backend } from './types';
import { serverBackend } from './server';
import { browserBackend } from './browser';

/**
 * `VITE_STANDALONE=1` produces the static build (GitHub Pages): no server,
 * localStorage for history, the visitor's own key for inference. Anything else
 * builds the desktop app that talks to the local Express server.
 */
export const backend: Backend =
  import.meta.env.VITE_STANDALONE === '1' ? browserBackend : serverBackend;

export type { Backend } from './types';
