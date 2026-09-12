/**
 * DATA_VERSION — bump when regenerating anything under /data/* or changing
 * bundle shape: every /data fetch is keyed by this version in its URL.
 * Single source of truth — the worker, the sim, and the engine all import
 * THIS file (two divergent copies once shipped stale hum to the worker).
 */
export const DATA_VERSION = 15;
