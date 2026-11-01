import { z } from "zod";

import { IDENTIFIER_PATTERN } from "./stringPatterns.js";
import { jsonValueSchema } from "./jsonValue.js";

import { absoluteLocalPathStringSchema } from "./localPath.js";
import { browserNetworkContentSelectionSchema } from "./browserNetworkEvidence.js";
import { browserScenarioEventFamilySchema } from "./browserScenarioCaptureValues.js";
import {
  browserScenarioCaptureLimitsSchema,
  DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
} from "./browserScenarioCaptureLimits.js";

import {
  browserEndpointSchema,
  browserOriginSchema,
} from "./browserObservation.js";

export const scenarioIdentifierSchema = z.string().regex(IDENTIFIER_PATTERN);

/**
 * Step identity the provider owns for the initial-state step. Callers cannot
 * claim it, because two capture steps with one identity cannot be aligned.
 */
export const BROWSER_SCENARIO_START_STEP_ID = "scenario_start";

const browserScenarioBaseUrlSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch (cause: unknown) {
      // Invalid input is reported through the zod issue.
      void cause;
      context.addIssue({ code: "custom", message: "Invalid browser URL" });
      return z.NEVER;
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      context.addIssue({
        code: "custom",
        message: "Browser URLs must be HTTP(S) and omit credentials",
      });
      return z.NEVER;
    }
    return url.toString();
  });

export const browserScenarioValueSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("literal"),
    value: z.string(),
  }),
  z.strictObject({
    source: z.literal("secret"),
    secret_id: scenarioIdentifierSchema,
  }),
]);
export type BrowserScenarioValue = z.infer<typeof browserScenarioValueSchema>;

const queryEntrySchema = z.strictObject({
  name: z.string().min(1),
  value: browserScenarioValueSchema,
});

/** HTTP methods a request step may send. */
export const BROWSER_SCENARIO_REQUEST_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

/** Header names a page's fetch cannot set (and User-Agent, which Chrome drops), so a request step refuses them rather than having them dropped. */
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
]);

/** Characters an HTTP field value may carry: visible ASCII, space, tab and obs-text. */
export const HEADER_FIELD_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/u;

const settableRequestHeader = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    !FORBIDDEN_REQUEST_HEADERS.has(lower) &&
    !lower.startsWith("proxy-") &&
    !lower.startsWith("sec-")
  );
};

/** A header value a request step reads from the page as it runs; it is redacted like a declared secret. */
const browserScenarioPageValueSchemas = [
  z.strictObject({
    source: z.literal("cookie"),
    name: z
      .string()
      .min(1)
      .describe("Cookie the browser holds for the request URL."),
  }),
  z.strictObject({
    source: z.literal("local_storage"),
    key: z.string().min(1).describe("Local storage key on the start origin."),
    json_pointer: z
      .string()
      .regex(/^(?:\/.*)?$/u)
      .optional()
      .describe(
        "Parse the stored value as JSON and use the string or number at this pointer; empty selects the whole value.",
      ),
  }),
] as const;

const requestHeaderSchema = z.strictObject({
  name: z
    .string()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u)
    .refine(settableRequestHeader, {
      message: "A page's fetch cannot set this header",
    }),
  value: z.discriminatedUnion("source", [
    ...browserScenarioValueSchema.options,
    ...browserScenarioPageValueSchemas,
  ]),
  prefix: z
    .string()
    .regex(HEADER_FIELD_VALUE, {
      message: "A header value cannot carry line breaks or control characters",
    })
    .optional()
    .describe("Text sent before the value, such as `Bearer `."),
});
export type BrowserScenarioRequestHeader = z.infer<typeof requestHeaderSchema>;

/** URL with ordinary inline details and optional structured secret query references. */
export const browserScenarioUrlSchema = z.strictObject({
  url: browserScenarioBaseUrlSchema,
  query: z.array(queryEntrySchema).default([]),
});
export type BrowserScenarioUrl = z.infer<typeof browserScenarioUrlSchema>;

export const browserScenarioBrowserSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("launch"),
    executable_path: absoluteLocalPathStringSchema.describe(
      "Absolute local filesystem path for the browser executable; relative paths are rejected.",
    ),
    headless: z
      .boolean()
      .default(true)
      .describe(
        "Run without a visible browser window; defaults to true and can be disabled when the host supports a display.",
      ),
  }),
  z.strictObject({
    mode: z.literal("connect"),
    cdp_endpoint: browserEndpointSchema,
    target_id: z.string().trim().min(1),
  }),
]);

export const browserScenarioEnvironmentSchema = z
  .strictObject({
    viewport: z
      .strictObject({
        width: z.int().positive().default(1_280),
        height: z.int().positive().default(720),
        device_scale_factor: z.number().positive().default(1),
      })
      .default({ width: 1_280, height: 720, device_scale_factor: 1 }),
    locale: z
      .string()
      .min(2)
      .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u)
      .default("en-US")
      .describe(
        "Formatting locale. Launch also sets navigator.language(s) and Accept-Language; connect retains the caller's page and request languages and reports this limitation.",
      ),
    timezone: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_+\x2d]+(?:\x2f[A-Za-z0-9_+\x2d]+)*$/u)
      .default("UTC"),
    color_scheme: z.enum(["light", "dark", "no-preference"]).default("light"),
    reduced_motion: z.enum(["reduce", "no-preference"]).default("reduce"),
    service_workers: z.enum(["allow", "block"]).default("block"),
  })
  .default({
    viewport: { width: 1_280, height: 720, device_scale_factor: 1 },
    locale: "en-US",
    timezone: "UTC",
    color_scheme: "light",
    reduced_motion: "reduce",
    service_workers: "block",
  })
  .describe(
    "Optional deterministic browser settings. Defaults to 1280x720, en-US, UTC, light mode, reduced motion, and blocked service workers.",
  );

const locatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("test_id"),
    value: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("role"),
    role: z.enum([
      "button",
      "checkbox",
      "combobox",
      "dialog",
      "link",
      "listbox",
      "menuitem",
      "option",
      "radio",
      "slider",
      "spinbutton",
      "switch",
      "tab",
      "textbox",
    ]),
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("css"),
    selector: z.string().min(1),
  }),
]);

// Playwright forwards these intervals to Node timers.
const MAX_BROWSER_SCENARIO_TIMEOUT_MS = 2_147_483_647;

const stepBase = {
  step_id: scenarioIdentifierSchema,
  timeout_ms: z
    .int()
    .min(1)
    .max(MAX_BROWSER_SCENARIO_TIMEOUT_MS)
    .optional()
    .describe(
      "Optional action deadline in milliseconds; omitted means wait until completion or request cancellation.",
    ),
};

export const browserScenarioActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...stepBase,
    action: z.literal("goto"),
    destination: browserScenarioUrlSchema,
    wait_until: z.enum(["commit", "domcontentloaded", "load"]),
  }),
  z.strictObject({
    ...stepBase,
    action: z.literal("click"),
    locator: locatorSchema,
    button: z.enum(["left", "middle", "right"]).default("left"),
    click_count: z.int().positive().default(1),
  }),
  z.strictObject({
    ...stepBase,
    action: z.literal("fill"),
    locator: locatorSchema,
    value: browserScenarioValueSchema,
  }),
  z.strictObject({
    ...stepBase,
    action: z.literal("press"),
    locator: locatorSchema,
    key: z.string().min(1),
  }),
  z.strictObject({
    ...stepBase,
    action: z.literal("select_option"),
    locator: locatorSchema,
    value: browserScenarioValueSchema,
  }),
  z.strictObject({
    ...stepBase,
    action: z.enum(["check", "uncheck"]),
    locator: locatorSchema,
  }),
  z.strictObject({
    ...stepBase,
    action: z.literal("wait_for"),
    locator: locatorSchema,
    state: z.enum(["attached", "detached", "visible", "hidden"]),
  }),
  z.strictObject({
    ...stepBase,
    action: z.literal("request"),
    method: z.enum(BROWSER_SCENARIO_REQUEST_METHODS),
    path: z
      .string()
      .regex(/^\/(?![/\\])/u)
      .describe(
        "Path, and optional literal query, on the start URL's origin, such as /api/folders; it must resolve to that origin.",
      ),
    query: z.array(queryEntrySchema).default([]),
    headers: z.array(requestHeaderSchema).default([]),
    json: jsonValueSchema
      .optional()
      .describe(
        "JSON request body, sent with Content-Type application/json unless a header sets one; not allowed for GET or HEAD.",
      ),
    expected_status: z
      .array(
        z
          .int()
          .min(100)
          .max(599)
          .refine((status) => status < 300 || status > 399, {
            message:
              "Request steps follow no redirects, so a 3xx status cannot complete one",
          }),
      )
      .min(1)
      .optional()
      .describe(
        "Statuses that complete the step; any other status fails it. Omitted means any response completes it.",
      ),
  }),
  z.strictObject({
    step_id: scenarioIdentifierSchema,
    action: z.literal("wait_for_timeout"),
    duration_ms: z
      .int()
      .min(1)
      .max(MAX_BROWSER_SCENARIO_TIMEOUT_MS)
      .describe(
        "Wait this many milliseconds; the wait ends early on cancellation.",
      ),
  }),
]);
export type BrowserScenarioAction = z.infer<typeof browserScenarioActionSchema>;

const storageEntrySchema = z.strictObject({
  name: z.string().min(1),
  value: browserScenarioValueSchema,
});

export const browserScenarioStorageSchema = z
  .strictObject({
    cookies: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          value: browserScenarioValueSchema,
          destination: browserScenarioUrlSchema,
          http_only: z.boolean(),
          secure: z.boolean(),
          same_site: z.enum(["Strict", "Lax", "None"]),
        }),
      )
      .default([]),
    local_storage: z
      .array(
        z.strictObject({
          origin: browserOriginSchema,
          entries: z.array(storageEntrySchema),
        }),
      )
      .default([]),
    session_storage: z
      .array(
        z.strictObject({
          origin: browserOriginSchema,
          entries: z.array(storageEntrySchema),
        }),
      )
      .default([]),
  })
  .default({ cookies: [], local_storage: [], session_storage: [] })
  .describe(
    "Optional initial cookies, local storage, or session storage. Defaults to empty; every supplied value and origin must be declared and within the allowed origins.",
  );

export const browserScenarioSecretSchema = z.strictObject({
  secret_id: scenarioIdentifierSchema,
  environment_variable: z
    .string()
    .min(1)
    .refine(
      (name) => !name.includes("=") && !name.includes("\0"),
      "Environment variable names cannot contain '=' or NUL",
    ),
});

const snapshotKindSchema = z.enum([
  "screenshot",
  "dom",
  "accessibility",
  "url",
  "history",
  "storage",
]);

export const browserScenarioCaptureSchema = z
  .strictObject({
    after_each_step: z.array(snapshotKindSchema).default([]),
    at_end: z.array(snapshotKindSchema).default(["url"]),
    events: z.array(browserScenarioEventFamilySchema).default([]),
    network: browserNetworkContentSelectionSchema,
    limits: browserScenarioCaptureLimitsSchema.default(
      DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
    ),
  })
  .default({
    after_each_step: [],
    at_end: ["url"],
    events: [],
    network: {
      request_body: false,
      response_body: false,
      header_values: false,
    },
    limits: DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
  })
  .describe(
    "Optional retained artifacts and event families. Defaults to only a final sanitized URL; request screenshots, DOM, accessibility, history, storage, and event capture explicitly.",
  );
