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
          Temp: "C:\\Users\\someone\\AppData\\Local\\Temp",
          TMP: "C:\\Users\\someone\\AppData\\Local\\Temp",
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
      // Without TEMP and TMP Windows falls back to C:\Windows\temp, which a
      // normal account may not open: analysis then fails with access denied.
      TEMP: "C:\\Users\\someone\\AppData\\Local\\Temp",
      TMP: "C:\\Users\\someone\\AppData\\Local\\Temp",
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
    "lets a child Node process start on Windows with the account's temp directory",
    async () => {
      const { stdout } = await execute(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify({ random: require('node:crypto').randomInt(1, 2), temp: require('node:os').tmpdir() }))",
        ],
        { env: { ...verifierHostEnvironment(), PATH: process.env.PATH ?? "" } },
      );
      const child = JSON.parse(stdout) as { random: number; temp: string };
      expect(child.random).toBe(1);
      expect(child.temp.toLowerCase()).toBe(
        (process.env.TEMP ?? "").toLowerCase(),
      );
    },
  );
});
