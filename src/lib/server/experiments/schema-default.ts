/** JSON Schema written beside Cursor instructions for results.json. */
export function defaultResultsSchema(
  experimentId: string,
): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["experimentId", "lockHash", "runs"],
    additionalProperties: true,
    properties: {
      experimentId: { type: "string", const: experimentId },
      lockHash: { type: "string", minLength: 16 },
      commit: { type: "string" },
      runs: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["seed", "metrics"],
          properties: {
            seed: { type: "number" },
            metrics: {
              type: "object",
              additionalProperties: { type: "number" },
            },
          },
        },
      },
      env: { type: "object" },
      notes: { type: "string" },
    },
  };
}
