/**
 * URL utilities.
 */

function findFirstMarkerIndex(pathname: string): number | null {
    const candidates: number[] = [];

    const addIndex = (index: number) => {
        if (index >= 0) {
            candidates.push(index);
        }
    };

    addIndex(pathname.indexOf('/user/'));
    addIndex(pathname.indexOf('/hub/'));
    addIndex(pathname.search(/\/lab(\/|$)/));
    addIndex(pathname.search(/\/tree(\/|$)/));
    addIndex(pathname.search(/\/notebooks(\/|$)/));
    addIndex(pathname.search(/\/edit(\/|$)/));

    if (candidates.length === 0) {
        return null;
    }

    return Math.min(...candidates);
}

/**
 * Normalize a user-provided JupyterHub/Jupyter URL into a stable base URL.
 *
 * Examples:
 * - https://host/user/name/lab -> https://host
 * - https://host/prefix/user/name/lab -> https://host/prefix
 * - https://host/prefix/ -> https://host/prefix
 */
export function normalizeHubBaseUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return trimmed;
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return trimmed.replace(/\/+$/, '');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return trimmed.replace(/\/+$/, '');
    }

    const origin = parsed.origin;
    const pathname = parsed.pathname || '/';

    const markerIndex = findFirstMarkerIndex(pathname);
    const basePath = markerIndex === null ? pathname : pathname.slice(0, markerIndex);
    const normalizedPath = basePath === '/' ? '' : basePath.replace(/\/+$/, '');

    return (origin + normalizedPath).replace(/\/+$/, '');
}

export function buildHubTokenPageUrl(hubBaseUrl: string): string {
    const base = hubBaseUrl.replace(/\/+$/, '');
    return `${base}/hub/token`;
}

