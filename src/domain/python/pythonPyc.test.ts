import { expect, it } from "vitest";
import {
  inspectPythonPycInputSchema,
  pythonPycMagicEntry,
  PYTHON_PYC_MAGIC_TABLE,
} from "./pythonPyc.js";

it("maps pinned CPython 3.7–3.13 magics and leaves gaps unknown", () => {
  expect(pythonPycMagicEntry(3394)).toEqual({
    python_version: "3.7",
    code_layout: "py37",
    header_bytes: 16,
    negative_code_fields: "accepted",
  });
  expect(pythonPycMagicEntry(3390)).toMatchObject({
    python_version: "3.7",
    header_bytes: 12,
  });
  expect(pythonPycMagicEntry(3391)).toMatchObject({
    python_version: "3.7",
    header_bytes: 12,
  });
  expect(pythonPycMagicEntry(3413)).toEqual({
    python_version: "3.8",
    code_layout: "py38",
    header_bytes: 16,
    negative_code_fields: "rejected",
  });
  expect(pythonPycMagicEntry(3401)?.negative_code_fields).toBe("accepted");
  expect(pythonPycMagicEntry(3410)?.negative_code_fields).toBe(
    "revision-dependent",
  );
  expect(pythonPycMagicEntry(3411)?.negative_code_fields).toBe("rejected");
  expect(pythonPycMagicEntry(3531)).toEqual({
    python_version: "3.12",
    code_layout: "py311",
    header_bytes: 16,
    negative_code_fields: "rejected",
  });
  expect(pythonPycMagicEntry(3571)).toEqual({
    python_version: "3.13",
    code_layout: "py311",
    header_bytes: 16,
    negative_code_fields: "rejected",
  });
  expect(pythonPycMagicEntry(3450)).toBeNull();
  expect(pythonPycMagicEntry(62171)).toBeNull();
  expect(PYTHON_PYC_MAGIC_TABLE.size).toBeGreaterThan(80);
});

it("rejects extra inspect arguments", () => {
  expect(
    inspectPythonPycInputSchema.safeParse({
      path: "/artifacts/module.pyc",
      detail: "complete",
    }).success,
  ).toBe(false);
});
