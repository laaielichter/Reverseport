import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { verifierHostEnvironment } from "../../../scripts/lib/verifier-host-environment.mjs";

const execute = promisify(execFile);
const project = fileURLToPath(new URL("../../../", import.meta.url));

describe("isolated verifier environments", () => {
  it("keep the Windows host variables a child Node process needs", () => {
    // A Windows child started without SystemRoot aborts with
    // `Assertion failed: ncrypto::CSPRNG(nullptr, 0)` before printing anything.
    expect(
      verifierHostEnvironment(
        {
          SYSTEMROOT: "C:\\Windows",
          windir: "C:\\Windows",
          ComSpec: "C:\\Windows\\system32\\cmd.exe",
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
          USERPROFILE: "C:\\Users\\someone",
          SECRET: "not copied",
        },
        "win32",
      ),
    ).toEqual({
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      ComSpec: "C:\\Windows\\system32\\cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    });
  });

  it("add nothing outside Windows", () => {
    expect(
      verifierHostEnvironment({ SystemRoot: "C:\\Windows" }, "linux"),
    ).toEqual({});
  });

  it.each(["qwen", "gemini", "commandcode", "deepseek"])(
    "is used by the %s client verifier, which runs on Windows",
    async (client) => {
      const source = await readFile(
        `${project}scripts/verify-${client}-client.mjs`,
        "utf8",
      );
      // `\s+` also spans the CRLF of a Windows autocrlf checkout.
      expect(source).toMatch(/\.\.\.verifierHostEnvironment\(\),\s+PATH:/u);
    },
  );

  it.runIf(process.platform === "win32")(
    "lets a child Node process start on Windows",
    async () => {
      const { stdout } = await execute(
        process.execPath,
        [
          "-e",
          "process.stdout.write(String(require('node:crypto').randomInt(1, 2)))",
        ],
        { env: { ...verifierHostEnvironment(), PATH: process.env.PATH ?? "" } },
      );
      expect(stdout).toBe("1");
    },
  );
});
