import { lstat } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";

// Only catalog verification needs built MCP contracts; path checks work
// from source without a runtime build.
const loadMcpVerifierResults = () => import("./mcp-verifier-results.mjs");

/** Verify schema validity and that the MCP catalog matches session metadata. */
export const verifyCompleteToolCatalog = async (client, options) => {
  const { requireMcpLifecycleResult, sortVerifierNames } =
    await loadMcpVerifierResults();
  const listed = await client.listTools(undefined, options);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  for (const tool of listed.tools) {
    for (const kind of ["inputSchema", "outputSchema"]) {
      const schema = tool[kind];
      if (schema !== undefined && !ajv.validateSchema(schema))
        throw new Error(
          `packaged MCP has invalid ${tool.name}.${kind}: ${ajv.errorsText(ajv.errors)}`,
        );
    }
  }
  const status = await client.callTool(
    { name: "binary_session", arguments: {} },
    options,
  );
  const expanded = requireMcpLifecycleResult(status, "binary_session");
  const availability = expanded.tool_availability;
  const expected = sortVerifierNames(availability.map(({ name }) => name));
  const observed = sortVerifierNames(listed.tools.map(({ name }) => name));
  if (JSON.stringify(observed) !== JSON.stringify(expected))
    throw new Error(
      "packaged MCP tool inventory diverged from session metadata",
    );
  return observed;
};

/** Check whether a path exists on disk. */
export const pathExists = async (path) => {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      return false;
    throw cause;
  }
};
