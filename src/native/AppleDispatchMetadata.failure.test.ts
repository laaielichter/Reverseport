import { expect, it } from "vitest";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { appleDispatchMetadataFailure } from "./AppleDispatchMetadata.js";

// The metadata target is already bound, so losing it is a change to that artifact rather than a new input error.
it.each(["integrity", "path"] as const)(
  "reports a %s source-read refusal as a change to the bound target, not a provider failure",
  (reason) => {
    const cause = new ArtifactReaderFailure(reason, "source boundary refused");
    expect(appleDispatchMetadataFailure(cause, "/selected")._tag).toBe(
      "AnalysisArtifactChangedError",
    );
  },
);
it.each(["EACCES", "EPERM", "ENOENT"])(
  "preserves the filesystem outcome %s for a bound metadata target",
  (code) => {
    const physical = Object.assign(new Error("selected read refused"), {
      code,
    });
    const cause = new ArtifactReaderFailure("io", "could not read", {
      cause: physical,
    });
    expect(appleDispatchMetadataFailure(cause, "/selected")._tag).toBe(
      code === "ENOENT"
        ? "AnalysisArtifactChangedError"
        : "AnalysisAccessDeniedError",
    );
  },
);
