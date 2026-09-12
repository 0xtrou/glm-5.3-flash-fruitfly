/**
 * DATA_VERSION — bump when regenerating anything under /data/*.
 * Bundles are served with immutable cache headers, so browsers keep old
 * copies forever unless the version in the URL changes.
 */
export const DATA_VERSION = 11;
