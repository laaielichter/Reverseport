import { expect, it } from "vitest";
import { recordedCrashSchema } from "../../domain/native/recordedCrash.js";
import {
  recordedCrashFixture,
  recordedCrashFixtureBytes,
} from "../../../tests/fixtures/binaryDiagnostics/recordedCrash.js";
import { validateRecordedCrashStructure } from "./RecordedCrashStructureBindings.js";

it.each([
  ["aarch64-little-endian", 0x70000000, "PT_AARCH64_ARCHEXT"],
  ["aarch64-little-endian", 0x70000001, "PT_AARCH64_UNWIND"],
  ["aarch64-little-endian", 0x70000003, 0x70000003],
  ["x86_64-little-endian", 0x70000001, 0x70000001],
] as const)(
  "binds %s header type %i independently of its decoder label %s",
  (architecture, typeId, label) => {
    const report = recordedCrashFixture(undefined, architecture);
    report.segments[0]!.type_id = typeId;
    report.segments[0]!.type = label;
    report.notes = [];
    report.threads = [];
    const bytes = recordedCrashFixtureBytes(report);
    const parsed = recordedCrashSchema.parse(report);
    expect(() =>
      validateRecordedCrashStructure(parsed, bytes, parsed.decoder_diagnostics),
    ).not.toThrow();
    bytes.writeUInt32LE(typeId + 1, 64);
    expect(() =>
      validateRecordedCrashStructure(parsed, bytes, parsed.decoder_diagnostics),
    ).toThrow(/original ELF\/note headers/);
  },
);

it.each([3, 0x46494c45])(
  "retains GNU-owned numeric note %i without CORE interpretation",
  (typeId) => {
    const report = recordedCrashFixture();
    report.notes[0]!.type_id = typeId;
    report.notes[0]!.type = typeId;
    report.notes[0]!.owner_bytes_base64 =
      Buffer.from("GNU\0\0").toString("base64");
    report.notes[0]!.owner_display = "GNU";
    report.threads = [];
    const bytes = recordedCrashFixtureBytes(report);
    const parsed = recordedCrashSchema.parse(report);
    expect(() =>
      validateRecordedCrashStructure(parsed, bytes, parsed.decoder_diagnostics),
    ).not.toThrow();
    report.notes[0]!.type = typeId === 3 ? "NT_PRPSINFO" : "NT_FILE";
    expect(recordedCrashSchema.safeParse(report).success).toBe(false);
  },
);
