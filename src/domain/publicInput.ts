import { z } from "zod";

/**
 * Closed object schema for a public CLI or MCP tool input.
 *
 * Unknown keys fail here so public input policy has one owner. Result and
 * internal objects stay on their own constructors.
 */
export const publicInputStrictObject = z.strictObject;
