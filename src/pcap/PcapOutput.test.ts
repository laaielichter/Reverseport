import { expect, it } from "vitest";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { parseCapinfosOutput, parseTsharkJsonOutput } from "./PcapOutput.js";

const capture = (layers: ReadonlyArray<Record<string, string[]>>) =>
  JSON.stringify(
    layers.map((fields, index) => ({
      _source: {
        layers: {
          "frame.number": [String(index + 1)],
          "frame.protocols": ["ip:udp:dns"],
          ...fields,
        },
      },
    })),
  );

it.each([
  [[], []],
  [["", ""], []],
  [["user_dlt:data", ""], [{ protocol: "user_dlt:data", packet_count: 1 }]],
  [["", "user_dlt:data"], [{ protocol: "user_dlt:data", packet_count: 1 }]],
  [
    ["user_dlt:data", "", "user_dlt:data"],
    [{ protocol: "user_dlt:data", packet_count: 2 }],
  ],
] as const)(
  "counts every frame while aggregating only reported protocol stacks: %j",
  async (stacks, expected) => {
    const result = await parseTsharkJsonOutput(
      capture(stacks.map((stack) => ({ "frame.protocols": [stack] }))),
    );
    expect(result.packetCount).toBe(stacks.length);
    expect(result.protocolDistribution).toEqual(expected);
    expect(result.protocolCount).toBe(expected.length);
    expect(result.partial).toBe(false);
  },
);

it.each([
  { "frame.number": ["1"] },
  { "frame.number": ["1"], "frame.protocols": [] },
  { "frame.number": ["1"], "frame.protocols": ["", "ip"] },
  { "frame.number": ["1"], "frame.protocols": ["ip", "ip"] },
  { "frame.number": ["1"], "frame.protocols": [null] },
  { "frame.number": ["1"], "frame.protocols": "" },
  { "frame.protocols": [""] },
  { "frame.number": ["2"], "frame.protocols": [""] },
])("rejects malformed or ambiguous frame inventories: %j", async (layers) => {
  await expect(
    parseTsharkJsonOutput(JSON.stringify([{ _source: { layers } }])),
  ).rejects.toMatchObject({ _tag: "AnalysisProtocolError" });
});

it.each(["before", "after"] as const)(
  "retains endpoint and DNS facts with an empty stack %s the response",
  async (position) => {
    const empty = { "frame.protocols": [""] };
    const response = {
      "frame.protocols": ["eth:ethertype:ip:udp:dns"],
      "ip.src": ["192.0.2.53"],
      "ip.dst": ["192.0.2.1"],
      "dns.qry.name": ["api.example"],
      "dns.flags.response": ["True"],
      "dns.a": ["203.0.113.5"],
    };
    const result = await parseTsharkJsonOutput(
      capture(position === "before" ? [empty, response] : [response, empty]),
    );
    expect(result).toMatchObject({
      packetCount: 2,
      protocolCount: 1,
      protocolDistribution: [
        { protocol: "eth:ethertype:ip:udp:dns", packet_count: 1 },
      ],
      endpointCount: 2,
      endpoints: [
        { address: "192.0.2.1", port: null, packet_count: 1 },
        { address: "192.0.2.53", port: null, packet_count: 1 },
      ],
      dnsQueryCount: 1,
      dnsQueries: [
        {
          query: "api.example",
          response_addresses: ["203.0.113.5"],
          response_address_count: 1,
        },
      ],
      partial: false,
    });
  },
);

it("rejects duplicate frame identities even when protocol stacks are empty", async () => {
  await expect(
    parseTsharkJsonOutput(
      capture([
        { "frame.protocols": [""] },
        { "frame.number": ["1"], "frame.protocols": [""] },
      ]),
    ),
  ).rejects.toMatchObject({ _tag: "AnalysisProtocolError" });
});

it("binds interleaved DNS answers to the question in their response packet", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      { "dns.qry.name": ["alpha.example"], "dns.flags.response": ["False"] },
      { "dns.qry.name": ["beta.example"], "dns.flags.response": ["False"] },
      {
        "dns.qry.name": ["alpha.example"],
        "dns.flags.response": ["True"],
        "dns.a": ["192.0.2.10"],
      },
      {
        "dns.qry.name": ["beta.example"],
        "dns.flags.response": ["True"],
        "dns.a": ["192.0.2.20"],
      },
    ]),
  );
  expect(result.dnsQueries).toEqual([
    {
      query: "alpha.example",
      response_addresses: ["192.0.2.10"],
      response_address_count: 1,
    },
    {
      query: "beta.example",
      response_addresses: ["192.0.2.20"],
      response_address_count: 1,
    },
  ]);
  expect(result.partial).toBe(false);
});

it("retains unassignable DNS addresses without inventing a query relationship", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      {
        "dns.qry.name": ["alpha.example", "beta.example"],
        "dns.flags.response": ["True"],
        "dns.a": ["192.0.2.9"],
      },
      { "dns.flags.response": ["True"], "dns.aaaa": ["2001:db8::9"] },
    ]),
  );
  expect(
    result.dnsQueries.every((query) => query.response_addresses.length === 0),
  ).toBe(true);
  expect(result.unattributedDnsAddresses).toEqual(["192.0.2.9", "2001:db8::9"]);
  expect(result.unattributedDnsPackets).toBe(2);
  expect(result.partial).toBe(true);
});

it("counts IPv6 endpoints once per packet and preserves every examined fact", async () => {
  const packets = Array.from({ length: 51 }, (_, index) => ({
    "ipv6.src": ["2001:db8::1"],
    "ipv6.dst": ["2001:db8::1"],
    "tls.handshake.extensions_server_name": [`host${String(index)}.example`],
    "frame.protocols": [`ipv6:protocol${String(index)}`],
  }));
  const result = await parseTsharkJsonOutput(capture(packets));
  expect(result.endpoints).toEqual([
    { address: "2001:db8::1", port: null, packet_count: 51 },
  ]);
  expect(result.tlsSniCount).toBe(51);
  expect(result.tlsSniValues).toHaveLength(51);
  expect(result.protocolCount).toBe(51);
  expect(result.protocolDistribution).toHaveLength(51);
  expect(result.partial).toBe(false);
});

it("orders equal-count endpoints and protocols by code point, not host locale", async () => {
  // Locale collation puts "fe80::1" first and, under da-DK, "aarp" after "zz".
  const result = await parseTsharkJsonOutput(
    capture([
      { "ipv6.src": ["fe80::1"], "frame.protocols": ["eth:llc:zz"] },
      { "ipv6.src": ["fe80:1::1"], "frame.protocols": ["eth:llc:aarp"] },
    ]),
  );
  expect(result.endpoints.map(({ address }) => address)).toEqual([
    "fe80:1::1",
    "fe80::1",
  ]);
  expect(result.protocolDistribution.map(({ protocol }) => protocol)).toEqual([
    "eth:llc:aarp",
    "eth:llc:zz",
  ]);
});

it("preserves all DNS addresses and their exact examined count", async () => {
  const result = await parseTsharkJsonOutput(
    capture(
      Array.from({ length: 101 }, (_, index) => ({
        "dns.qry.name": ["rotating.example"],
        "dns.flags.response": ["True"],
        "dns.a": [`192.0.2.${String(index)}`],
      })),
    ),
  );
  expect(result.dnsQueries[0]?.response_addresses).toHaveLength(101);
  expect(result.dnsQueries[0]?.response_address_count).toBe(101);
  expect(result.partial).toBe(false);
});

it("accepts exact machine packet counts and rejects scaled human counts", () => {
  const prefix =
    "File type: pcap\nFile encapsulation: Ethernet\nNumber of packets: ";
  expect(parseCapinfosOutput(`${prefix}20010`).packetCount).toBe(20010);
  expect(() => parseCapinfosOutput(`${prefix}20 k`)).toThrow(
    /machine-readable/u,
  );
});

it("excludes transport credentials without normalizing observed URL bytes", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      {
        "http.request.full_uri": [
          "http://user:password@Example.com/a/../b?token=local-evidence#keep",
        ],
      },
      {
        "http.request.full_uri": [
          "http://other:secret@Example.com/a/../b?token=local-evidence#keep",
        ],
      },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://Example.com/a/../b?token=local-evidence#keep",
  ]);
  expect(result.httpRequestUriCount).toBe(2);
  expect(result.httpUriRedactionCount).toBe(2);
  expect(result.partial).toBe(true);
});

it("retains HTTP absolute-form request targets when Wireshark cannot synthesize full_uri", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      { "http.request.uri": ["http://proxy.example.test/a/../resource"] },
      { "http.request.uri": ["/relative/path"] },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://proxy.example.test/a/../resource",
  ]);
  expect(result.httpRequestUriCount).toBe(1);
  expect(result.partial).toBe(true);
});

it("marks mixed request arrays partial when a relative target has no full URI", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      {
        "http.request.uri": ["/resolved/with-host", "/unresolved/without-host"],
        "http.request.full_uri": ["http://host.example/resolved/with-host"],
      },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://host.example/resolved/with-host",
  ]);
  expect(result.partial).toBe(true);
});

it("accounts for paired full URIs and absolute-form values without inventing array joins", async () => {
  const result = await parseTsharkJsonOutput(
    capture([
      {
        "http.request.uri": ["/first", "/second", "http://proxy.example/third"],
        "http.request.full_uri": [
          "http://host.example/first",
          "http://host.example/second",
          "http://proxy.example/third",
        ],
      },
    ]),
  );
  expect(result.httpRequestUris).toEqual([
    "http://host.example/first",
    "http://host.example/second",
    "http://proxy.example/third",
  ]);
  expect(result.partial).toBe(false);
});

it("refuses dense JSON before its expanded graph exceeds the decoding budget", async () => {
  await expect(
    parseTsharkJsonOutput(`[${"{},".repeat(600_000)}{}]`),
  ).rejects.toMatchObject({
    _tag: "AnalysisResourceConstraintError",
  });
});

it.each([
  null,
  "stopped",
  new ProviderCleanupError("caller", ["foreign-resource"], {}),
])(
  "preserves opaque cancellation while validating producer output: %s",
  async (reason) => {
    const controller = new AbortController();
    const result = parseTsharkJsonOutput(
      capture([{ "ip.src": ["192.0.2.1"] }]),
      controller.signal,
    );
    controller.abort(reason);
    const failure = await result.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    if (!(failure instanceof AnalysisCancelledError)) throw failure;
    expect(failure.cause).toBe(reason);
    expect(failure.cleanupIncomplete).toBe(false);
    expect(failure.cleanupResources).toEqual([]);
    if (reason instanceof ProviderCleanupError)
      expect(reason.cleanupIncomplete).toBe(true);
  },
);

it("includes decoded HTTP/2 URIs with shared credential handling and reports unresolved targets", async () => {
  const full = await parseTsharkJsonOutput(
    capture([
      {
        "http2.request.full_uri": [
          "http://example.test/h2",
          "https://user:pass@example.test/kept",
        ],
        "http2.headers.path": ["/h2", "/kept"],
      },
      { "http.request.full_uri": ["http://example.test/h1"] },
    ]),
  );
  expect(full.httpRequestUris).toEqual([
    "http://example.test/h2",
    "https://example.test/kept",
    "http://example.test/h1",
  ]);
  expect(full.httpRequestUriCount).toBe(3);
  expect(full.httpUriRedactionCount).toBe(1);
  expect(full.partial).toBe(false);
  expect(
    (
      await parseTsharkJsonOutput(
        capture([{ "http2.headers.path": ["/unresolved"] }]),
      )
    ).partial,
  ).toBe(true);
});
