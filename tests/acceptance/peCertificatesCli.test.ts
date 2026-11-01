import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  peCertificateFixture,
  peWithoutCertificateTableFixture,
  pkcs7SignedDataFixture,
  pkcs7SignedDataIndefiniteEnvelopeFixture,
} from "../../src/native/pe/PeCertificates.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "reports PKCS#7 signer identity through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-cert-cli-");
    const path = join(root, "signed.exe");
    await writeFile(path, peCertificateFixture());
    const result = await cli.run({
      arguments: ["inspect-pe-certificates", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_pe_certificates").outputSchema.parse(
      result.json,
    );
    expect(
      evidence.normalized_result.entries[0]?.pkcs7?.certificates[0]?.serial_hex,
    ).toBe("11223344");
  },
);

cliTest(
  "inspects SignedData with an indefinite constructed ContentInfo envelope",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-cert-ber-cli-");
    const path = join(root, "ber-signed.exe");
    const payload = pkcs7SignedDataIndefiniteEnvelopeFixture();
    await writeFile(path, peCertificateFixture(false, payload));

    const result = await cli.run({
      arguments: ["inspect-pe-certificates", path, "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_pe_certificates").outputSchema.parse(
      result.json,
    );
    const entry = evidence.normalized_result.entries[0];
    expect(entry?.pkcs7?.certificates[0]).toMatchObject({
      serial_hex: "11223344",
    });
    expect(entry?.payload.bytes).toBe(payload.length);
    expect(entry?.pkcs7?.certificates[0]?.location.bytes).toBeGreaterThan(0);
  },
);

cliTest(
  "resolves a relative PE path against the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-cert-cli-rel-");
    await writeFile(
      join(root, "unsigned.exe"),
      peWithoutCertificateTableFixture(),
    );
    const result = await cli.run({
      arguments: ["inspect-pe-certificates", "unsigned.exe", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_pe_certificates").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.table).toBeNull();
    expect(evidence.subject?.local_path).toBe(join(root, "unsigned.exe"));
  },
);

cliTest("reports a truncated PE as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-pe-cert-cli-bad-");
  const path = join(root, "broken.exe");
  await writeFile(path, Buffer.from("MZ"));
  const result = await cli.run({
    arguments: ["inspect-pe-certificates", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_pe_certificates" },
  });
});

cliTest(
  "reports TeletexString compatibility text with its decoding limitation",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pe-cert-cli-teletex-");
    const path = join(root, "teletex.exe");
    const payload = pkcs7SignedDataFixture("é");
    const nameAt = payload.indexOf(Buffer.from([0x0c, 0x02, 0xc3, 0xa9]));
    expect(nameAt).toBeGreaterThanOrEqual(0);
    // Replace an equal-length UTF8String with T.61's acute accent plus 'e'.
    Buffer.from([0x14, 0x02, 0xc2, 0x65]).copy(payload, nameAt);
    await writeFile(path, peCertificateFixture(false, payload));
    const result = await cli.run({
      arguments: ["inspect-pe-certificates", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_pe_certificates").outputSchema.parse(
      result.json,
    );
    expect(
      evidence.normalized_result.entries[0]?.pkcs7?.certificates[0]?.issuer
        .text,
    ).toBe("commonName=Âe, organizationName=REA Tests");
    expect(evidence.normalized_result.limitations).toContain(
      "TeletexString values use OpenSSL's ISO-8859-1 compatibility mapping; this is not a full T.61 decoder.",
    );
  },
);
