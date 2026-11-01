import { completable } from "@modelcontextprotocol/server";
import { z } from "zod";
import type {
  PromptArgumentContract,
  PromptContract,
} from "../contracts/promptContracts.js";
import type { PromptCompletionSource } from "./promptCompletion.js";

export const promptArgumentsSchema = (
  contract: Pick<PromptContract, "arguments">,
  completion: PromptCompletionSource,
) => {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, argument] of Object.entries(contract.arguments))
    shape[name] = argumentSchema(argument, completion);
  return z.object(shape);
};

const argumentSchema = (
  argument: PromptArgumentContract,
  completion: PromptCompletionSource,
): z.ZodType => {
  const value = z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0)
    .describe(argument.description);
  const kind = argument.completion;
  const completed =
    kind === undefined
      ? value
      : completable(value, async (partial, context) => [
          ...(await completion.complete(kind, partial, context)),
        ]);
  return argument.required ? completed : completed.optional();
};
