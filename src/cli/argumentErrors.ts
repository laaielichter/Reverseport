import { Errors } from "incur";

import type { CliInstance } from "./types.js";
import { visitRegisteredCommands } from "./visitRegisteredCommands.js";

const ARGUMENT_GUIDANCE =
  "REA could not read the command arguments. Check the named argument and its expected type, then try again.";

/** Preserve parser correction fields without embedding its serialized cause. */
export const presentCliArgumentErrors = (cli: CliInstance): void => {
  visitRegisteredCommands(cli, (command) => {
    command.middleware = [
      async (_context, next) => {
        try {
          await next();
        } catch (cause: unknown) {
          if (!(cause instanceof Errors.ValidationError)) throw cause;
          const failure = new Errors.ValidationError({
            message: ARGUMENT_GUIDANCE,
            fieldErrors: cause.fieldErrors,
          });
          // Incur's constructor appends cause.message as display details. Keep
          // the original error separately, without copying it into the message.
          Object.defineProperty(failure, "cause", { value: cause });
          throw failure;
        }
      },
      ...(command.middleware ?? []),
    ];
  });
};
