import { z } from "incur";

import type { CliInstance } from "./types.js";
import { visitRegisteredCommands } from "./visitRegisteredCommands.js";

type CommandInputs = Partial<Record<(typeof INPUT_GROUPS)[number], unknown>>;

const INPUT_GROUPS = ["args", "env", "options"] as const;

/**
 * Advertise parser-filled defaults as omittable CLI inputs.
 *
 * Incur derives `--schema`, the `--llms` manifests, and help synopses from
 * Zod's output view, where a defaulted field always has a value and is
 * therefore listed as required. Callers may omit such a field, so each one is
 * wrapped as optional while its default, constraints, metadata, and parsed
 * value stay unchanged.
 */
export const presentOmittableDefaults = (cli: CliInstance): void => {
  visitRegisteredCommands(cli, (command) => presentInputs(command));
};

const presentInputs = (command: CommandInputs): void => {
  for (const group of INPUT_GROUPS) {
    const schema = command[group];
    if (schema instanceof z.ZodObject)
      command[group] = withOmittableDefaults(schema);
  }
};

const withOmittableDefaults = (schema: z.ZodObject): z.ZodObject => {
  const omittable = Object.entries(schema.shape).filter(([, field]) =>
    fillsOmission(field),
  );
  if (omittable.length === 0) return schema;
  return schema.safeExtend(
    Object.fromEntries(
      omittable.map(([key, field]) => [key, optionalWithMetadata(field)]),
    ),
  );
};

/**
 * Zod accepts an omitted value (`optin`) but always produces one (`optout`).
 * Zod 4.6 reports defaulted fields as `optin: "defaulted"`; older releases
 * reported `"optional"`, so any omittable input counts.
 */
const fillsOmission = (field: z.ZodType): boolean =>
  field._zod.optin !== undefined && field._zod.optout === undefined;

const optionalWithMetadata = (field: z.ZodType): z.ZodType => {
  const metadata = field.meta();
  return metadata === undefined
    ? field.optional()
    : field.optional().meta(metadata);
};
