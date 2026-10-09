/**
 * Canonical runtime guards for this package.
 *
 * MCP arguments are wire input: they are `unknown` until a guard proves the
 * properties actually used. Keep every record check here so call sites cannot
 * drift into their own incompatible variants.
 */

/** Narrows to a plain object. Field shapes remain `unknown` on purpose. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
