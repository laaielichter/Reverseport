import type { AsarHeaderAdmission } from "../../config/asarHeaderAdmission.js";
import { AsarArtifactReader } from "../AsarArtifactReader.js";
import type { ArtifactReader } from "../ArtifactReader.js";
import { DirectoryArtifactReader } from "../DirectoryArtifactReader.js";

/** Create the reader for an admitted JavaScript artifact format. */
export const createJavaScriptArtifactReader = (
  path: string,
  format: "asar" | "directory",
  asarHeaderAdmission?: AsarHeaderAdmission,
): ArtifactReader =>
  format === "asar"
    ? new AsarArtifactReader(
        path,
        asarHeaderAdmission === undefined
          ? {}
          : { headerAdmission: asarHeaderAdmission },
      )
    : new DirectoryArtifactReader(path, "omit");
