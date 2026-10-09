/**
 * JSON Schema builder satisfying the core's `SchemaBuilder` seam.
 *
 * The omp frontend authors its schemas with the pi.typebox shim; this module
 * authors the same schemas as plain JSON Schema so the MCP frontend does not
 * need the omp package. Parity between the two is asserted by
 * scripts/check-schema-parity.mjs — if they drift, the agent sees a different
 * contract depending on which frontend it talks to.
 */
import type { JsonSchema, SchemaBuilder, SchemaOptions } from "../../../src/tools.ts";

/**
 * Schemas that must be omitted from their parent's `required` list.
 *
 * A WeakSet, not a marker key: the emitted object is therefore valid JSON
 * Schema with no internal fields a validator or client could trip over.
 */
const optionalSchemas = new WeakSet<object>();

function withMeta(base: JsonSchema, options?: SchemaOptions): JsonSchema {
	if (!options) return base;
	if (typeof options.description === "string") base.description = options.description;
	if (typeof options.minItems === "number") base.minItems = options.minItems;
	if (typeof options.maxItems === "number") base.maxItems = options.maxItems;
	return base;
}

function buildObject(
	properties: Record<string, JsonSchema>,
	options?: SchemaOptions,
): JsonSchema {
	const required: string[] = [];
	for (const [key, schema] of Object.entries(properties)) {
		if (!optionalSchemas.has(schema)) required.push(key);
	}
	const result: JsonSchema = { type: "object", properties };
	if (required.length > 0) result.required = required;
	return withMeta(result, options);
}

export const jsonSchemaType: SchemaBuilder<JsonSchema> = {
	String: (options) => withMeta({ type: "string" }, options),
	Number: (options) => withMeta({ type: "number" }, options),
	Boolean: (options) => withMeta({ type: "boolean" }, options),
	Literal: (value) => ({ const: value }),
	Union: (schemas, options) => withMeta({ anyOf: [...schemas] }, options),
	Array: (schema, options) =>
		withMeta({ type: "array", items: schema }, options),
	Object: buildObject,
	Optional: (schema) => {
		optionalSchemas.add(schema);
		return schema;
	},
};
