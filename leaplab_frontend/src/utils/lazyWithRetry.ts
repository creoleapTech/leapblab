/**
 * Shared lazyWithRetry helper — protects Vite code-split chunks from stale-cache 404s.
 * Cloudflare Pages / CDN may serve a cached index.html that references old hashed chunks.
 * When the hash has rotated after a deploy, the old chunk URL returns index.html
 * (MIME type text/html) → "Failed to fetch dynamically imported module".
 *
 * This wrapper retries once and forces a reload (with cache bypass) before surfacing error.
 */
import { lazy } from 'react';

function isChunkLoadError(err: unknown): boolean {
    const msg = (err as any)?.message ? String((err as any).message) : String(err ?? '');
    return (
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('Loading chunk') ||
        msg.includes('ChunkLoadError') ||
        msg.includes('Failed to load module script') ||
        msg.includes('MIME type') ||
        msg.includes('Expected a JavaScript') ||
        msg.includes('dynamically imported module')
    );
}

export function lazyWithRetry<T>(
    importFn: () => Promise<{ default: T }>,
    chunkName?: string,
) {
    return lazy(async () => {
        try {
            const mod = await importFn();
            // success — clear any prior retry flag so future real failures can retry again
            try {
                sessionStorage.removeItem('chunk-retry');
                if (chunkName) sessionStorage.removeItem(`chunk-retry:${chunkName}`);
            } catch {}
            return mod;
        } catch (err: any) {
            if (isChunkLoadError(err)) {
                const globalKey = 'chunk-retry';
                const namedKey = chunkName ? `chunk-retry:${chunkName}` : null;
                let hasRetried = false;
                try {
                    hasRetried =
                        sessionStorage.getItem(globalKey) === '1' ||
                        (namedKey ? sessionStorage.getItem(namedKey) === '1' : false);
                } catch {
                    hasRetried = false;
                }
                if (!hasRetried) {
                    try {
                        sessionStorage.setItem(globalKey, '1');
                        if (namedKey) sessionStorage.setItem(namedKey, '1');
                    } catch {}
                    // Add cache-bust param and force reload from server (not disk cache)
                    const url = new URL(window.location.href);
                    url.searchParams.set('_r', Date.now().toString());
                    window.location.replace(url.toString());
                    // Also try hard reload as fallback
                    try {
                        window.location.reload();
                    } catch {}
                    // Prevent React from rendering error boundary while reload is pending
                    return new Promise<never>(() => {});
                }
            }
            throw err;
        }
    });
}

// Re-export helper for ErrorBoundary to share detection logic
export { isChunkLoadError };

// Global listener for <link rel="modulepreload"> failures (Vite emits vite:preloadError)
if (typeof window !== 'undefined') {
    window.addEventListener('vite:preloadError', (e: Event) => {
        e.preventDefault();
        try {
            const hasRetried = sessionStorage.getItem('chunk-retry') === '1';
            if (!hasRetried) {
                sessionStorage.setItem('chunk-retry', '1');
                const url = new URL(window.location.href);
                url.searchParams.set('_r', Date.now().toString());
                window.location.replace(url.toString());
                return;
            }
        } catch {}
        try {
            window.location.reload();
        } catch {}
    });
}
