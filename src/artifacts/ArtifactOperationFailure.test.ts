import { expect, it } from "vitest";

import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { translateArtifactFailure } from "./ArtifactOperationFailure.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

it.each(["capacity", "file-size", "memory"] as const)(
  "retains the producing %s limit through public error projection",
  (boundary) => {
    const failure = new ArtifactReaderFailure(
      "limit",
      "The specific reader allowance was exceeded",
      { boundary },
    );
    const result = projectAnalysisError(
      translateArtifactFailure("inventory_artifact", failure),
    );
    expect(result).toMatchObject({
      code: "truncated",
      retryable: false,
      message: failure.message,
      details: { boundary, detail: failure.message },
    });
  },
);
