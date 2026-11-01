import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  editHermesConfigurationYaml,
  parseHermesConfigurationYaml,
  stringifyHermesConfigurationYaml,
} from "./HermesConfigurationYaml.js";

for (const version of ["1.1", "1.2"] as const)
  it.each(["refresh", "remove"] as const)(
    `preserves YAML ${version} consumers of a replaced REA anchor during %s`,
    (operation) => {
      const original =
        `${version === "1.2" ? "%YAML 1.2\n---\n" : ""}` +
        "mcp_servers:\n  rea: &server\n    command: old-rea\n    args: [mcp]\n    env: &environment {MODE: 'on'}\n  other: *server # caller binding\nobserver: *server\nenvironment: *environment\n";
      const before = parse(original, { version });
      const updated = editHermesConfigurationYaml(
        original,
        ["mcp_servers", "rea"],
        operation === "refresh"
          ? { command: "new-rea", args: ["mcp"] }
          : undefined,
      );
      expect(parse(updated, { version })).toEqual({
        mcp_servers: {
          ...(operation === "refresh"
            ? { rea: { command: "new-rea", args: ["mcp"] } }
            : {}),
          other: before.mcp_servers.other,
        },
        observer: before.observer,
        environment: before.environment,
      });
      expect(updated).toContain("# caller binding");
      expect(
        editHermesConfigurationYaml(
          updated,
          ["mcp_servers", "rea"],
          operation === "refresh"
            ? { command: "new-rea", args: ["mcp"] }
            : undefined,
        ),
      ).toBe(updated);
    },
  );

describe("Hermes YAML deletion", () => {
  for (const version of ["1.1", "1.2"] as const) {
    for (const [name, body, path] of [
      [
        "an aliased table",
        "server_defaults: &servers\n  other:\n    command: other-server\n\nmcp_servers: *servers # Selected table\n",
        ["mcp_servers", "rea"],
      ],
      [
        "nested aliases",
        "defaults: &defaults\n  other: {command: other-server}\nservers: &servers\n  mcp_servers: *defaults\nclient: *servers\nobserver: *servers\n",
        ["client", "mcp_servers", "rea"],
      ],
      [
        "shadowed anchors",
        "first: &server {command: original}\ndefaults: &servers\n  other: *server\nsecond: &server {command: replacement}\nmcp_servers: *servers\nobserver: *server\n",
        ["mcp_servers", "rea"],
      ],
      [
        "shared consumers",
        "defaults: &servers\n  other: &other {command: other-server}\nmcp_servers: *servers\nobserver: *servers\nother_observer: *other\n",
        ["mcp_servers", "rea"],
      ],
      [
        "an explicit flow table with CRLF",
        "# Keep formatting\r\nmcp_servers: {other: {command: other-server}}\r\n",
        ["mcp_servers", "rea"],
      ],
    ] as const) {
      it(`preserves YAML ${version} bytes when deleting an absent key from ${name}`, () => {
        const source = (version === "1.2" ? "%YAML 1.2\n---\n" : "") + body;
        expect(editHermesConfigurationYaml(source, path, undefined)).toBe(
          source,
        );
      });
    }
  }

  for (const [name, reference] of [
    ["cyclic", "servers"],
    ["unresolved", "missing"],
  ]) {
    it(`still refuses deletion through a table containing a ${name} alias`, () => {
      const source = `defaults: &servers\n  rea: {command: rea}\n  other: *${reference}\nmcp_servers: *servers\n`;
      expect(() =>
        editHermesConfigurationYaml(source, ["mcp_servers", "rea"], undefined),
      ).toThrow(TypeError);
    });
  }
});

describe("Hermes configuration YAML", () => {
  it("retains a quoted sequence element when replacing its registration", () => {
    const source =
      "mcp_servers:\n  rea:\n    command: old\n    args:\n      - 'mcp'\n";
    expect(
      editHermesConfigurationYaml(source, ["mcp_servers", "rea"], {
        command: "rea",
        args: ["mcp"],
      }),
    ).toBe(source.replace("command: old", "command: rea"));
  });

  it("retains explicit string tags on unchanged keys and values", () => {
    const source =
      "%YAML 1.2\n---\nmcp_servers:\n  rea:\n    command: old\n    env:\n      !!str ON: !!str off\n";
    const written = editHermesConfigurationYaml(
      source,
      ["mcp_servers", "rea"],
      {
        command: "rea",
        env: { ON: "off" },
      },
    );
    expect(written).toBe(source.replace("command: old", 'command: "rea"'));
    expect(
      parse(written.slice("%YAML 1.2\n---\n".length), { version: "1.1" }),
    ).toMatchObject({ mcp_servers: { rea: { env: { ON: "off" } } } });
  });

  it("writes an edited number from its new value", () => {
    expect(
      editHermesConfigurationYaml("mode: 0600\nmask: 0x1F\n", ["mode"], 420),
    ).toBe("mode: 0644\nmask: 0x1F\n");
  });

  it("accepts keys Hermes reads as distinct and rejects a repeated key", () => {
    expect(() =>
      parseHermesConfigurationYaml("0600: octal\n600: decimal\n"),
    ).not.toThrow();
    expect(() => parseHermesConfigurationYaml('a: 1\n"a": 2\n')).toThrow();
    expect(() => parseHermesConfigurationYaml("yes: 1\ntrue: 2\n")).toThrow();
    expect(() => parseHermesConfigurationYaml("no: 1\noff: 2\n")).toThrow();
  });

  it("matches Hermes numeric key equality without losing large integer precision", () => {
    for (const text of [
      "1: first\n01: second\n",
      "1.0: first\n1.00: second\n",
      "true: first\n1: second\n",
      "false: first\n0.0: second\n",
      ".nan: first\n.NAN: second\n",
      "9007199254740992: first\n9007199254740992.0: second\n",
    ])
      expect(() => parseHermesConfigurationYaml(text)).toThrow();

    expect(() =>
      parseHermesConfigurationYaml(
        "9007199254740992: first\n9007199254740993: second\n",
      ),
    ).not.toThrow();
    expect(() =>
      parseHermesConfigurationYaml(
        "9007199254740993: first\n9007199254740993.0: second\n",
      ),
    ).not.toThrow();
    expect(() =>
      parseHermesConfigurationYaml("0600: octal\n600: decimal\n"),
    ).not.toThrow();
    expect(parseHermesConfigurationYaml("value: 9007199254740993\n")).toEqual({
      value: Number("9007199254740993"),
    });
  });

  it("matches Hermes timestamp key precision, timezone, and date-type equality", () => {
    for (const text of [
      "2026-10-14T00:00:00.123456+08:00: first\n2026-10-13T16:00:00.123456Z: second\n",
      "2026-10-14T00:00:00.1234565Z: first\n2026-10-14T00:00:00.123457Z: second\n",
    ])
      expect(() => parseHermesConfigurationYaml(text)).toThrow();

    expect(() =>
      parseHermesConfigurationYaml(
        "2026-10-14T00:00:00.123456Z: first\n2026-10-14T00:00:00.123457Z: second\n",
      ),
    ).not.toThrow();
    expect(() =>
      parseHermesConfigurationYaml(
        "2026-10-14: date\n2026-10-14T00:00:00Z: timestamp\n",
      ),
    ).not.toThrow();
    expect(() =>
      parseHermesConfigurationYaml(
        "2026-10-14T00:00:00: local\n2026-10-14T00:00:00Z: utc\n",
      ),
    ).not.toThrow();
  });

  it("matches Hermes timestamp resolution and rejects invalid calendar values", () => {
    expect(parseHermesConfigurationYaml("short: 2026-1-1\n")).toEqual({
      short: "2026-1-1",
    });
    expect(
      parseHermesConfigurationYaml("short: 2026-1-1 1:02:03.\n"),
    ).toMatchObject({ short: expect.any(Date) });
    expect(
      parseHermesConfigurationYaml("short: 2026-01-01 1:02:03\n"),
    ).toMatchObject({ short: expect.any(Date) });
    expect(parseHermesConfigurationYaml("short: 2026-01-01 1:2:03\n")).toEqual({
      short: "2026-01-01 1:2:03",
    });
    expect(parseHermesConfigurationYaml("short: 2026-01-01 1:02:3\n")).toEqual({
      short: "2026-01-01 1:02:3",
    });
    const firstYear = parseHermesConfigurationYaml("date: 0001-01-01\n") as {
      date: Date;
    };
    expect(firstYear.date.getUTCFullYear()).toBe(1);
    expect(
      parseHermesConfigurationYaml("date: 1969-12-31T23:59:59.999999Z\n"),
    ).toEqual({ date: new Date("1969-12-31T23:59:59.999Z") });

    for (const invalid of [
      "date: 0000-01-01\n",
      "date: 2026-02-30\n",
      "date: 2026-01-01 24:00:00\n",
      "date: 2026-01-01 00:00:00+24\n",
      "date: 9999-12-31T23:59:59.9999995Z\n",
    ])
      expect(() => parseHermesConfigurationYaml(invalid)).toThrow();
  });

  it("preserves YAML 1.1 strings on fresh files and honors directives on edits", () => {
    const created = stringifyHermesConfigurationYaml({
      mcp_servers: { rea: { env: { PROFILE: "off" } } },
    });
    expect(parse(created, { version: "1.1" })).toMatchObject({
      mcp_servers: { rea: { env: { PROFILE: "off" } } },
    });

    const original =
      "%YAML 1.2\n---\nnotify: on\ntimestamp: 2026-10-14T00:00:00.123456+08:00\n";
    const updated = editHermesConfigurationYaml(original, ["environment"], {
      SETTING: "off",
      DATE: "2026-10-14",
    });
    expect(updated.startsWith(original)).toBe(true);
    expect(parse(updated)).toMatchObject({
      notify: "on",
      environment: { SETTING: "off", DATE: "2026-10-14" },
    });
    expect(
      parseHermesConfigurationYaml("%YAML 1.2\n---\ndate: 2026-10-14\n"),
    ).toEqual({ date: new Date("2026-10-14") });
  });
});
