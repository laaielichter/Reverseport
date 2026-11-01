import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves scoped IPC allocations without global dispatch pairing through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-scoped-ipc-");
    const copy = `const {BrowserWindow}=require("electron"); const window=new BrowserWindow(); window.webContents.ipc.handle("copied",()=>{});`;
    await writeFixtureFiles(root, {
      "copy-one.cjs": copy,
      "copy-two.cjs": copy,
      "main.cjs": `const { BrowserWindow, ipcMain } = require("electron");
        const first = new BrowserWindow();
        const second = new BrowserWindow();
        first.webContents.mainFrame.ipc.handle("shared", () => "first");
        second.webContents.mainFrame.ipc.handle("shared", () => "second");
        ipcMain.handle("shared", () => "global");
        const dynamicWindow = new BrowserWindow();
        dynamicWindow.webContents.ipc.handle(dynamicChannel, () => "dynamic");
        ipcMain.handle("dynamic-shadow", () => "global");
        const fake = { webContents: { ipc: { handle() {} } } };
        fake.webContents.ipc.handle("fake", () => {});`,
      "preload.cjs": `const { ipcRenderer } = require("electron");
        ipcRenderer.invoke("shared");
        ipcRenderer.invoke("dynamic-shadow");`,
    });
    const application = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(application.statistics.parse_failures).toBe(0);
    expect(application.summary.ipc).toMatchObject({
      operations: 9,
      main_handlers: 7,
      renderer_transmissions: 2,
      paired_renderer_transmissions: 0,
      ambiguous_renderer_transmissions: 2,
    });
    const channels = application.graph.nodes.filter(
      ({ kind }) => kind === "ipc-channel",
    );
    const copies = application.graph.nodes.filter(
      ({ kind, observations }) =>
        kind === "ipc-handler" &&
        observations.some(({ properties }) => properties.channel === "copied"),
    );
    expect(copies).toHaveLength(2);
    expect(
      channels.filter(({ observations }) =>
        observations.some(({ properties }) => properties.channel === "copied"),
      ),
    ).toHaveLength(2);
    const shared = channels.filter(({ observations }) =>
      observations.some(({ properties }) => properties.channel === "shared"),
    );
    expect(shared).toHaveLength(3);
    const scoped = shared.filter(({ observations }) =>
      observations.some(({ properties }) => properties.receiver !== undefined),
    );
    expect(scoped).toHaveLength(2);
    const owners = scoped.flatMap(({ observations }) =>
      observations.map(({ properties }) => properties.receiver),
    );
    expect(new Set(owners.map((owner) => JSON.stringify(owner))).size).toBe(2);
    expect(
      channels.some(({ observations }) =>
        observations.some(({ properties }) => properties.channel === "fake"),
      ),
    ).toBe(false);
    expect(
      application.graph.edges.filter(
        ({ evidence }) =>
          evidence.extractor.operation === "pair-ipc-literal-channel",
      ),
    ).toEqual([]);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "does not uniquely pair a renderer with exactly one scoped literal handler through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-single-scoped-ipc-");
    await writeFixtureFiles(root, {
      "main.cjs": `const { BrowserWindow } = require("electron");
        const window = new BrowserWindow();
        window.webContents.mainFrame.ipc.handle("only-scoped", () => "result");`,
      "preload.cjs": `const { ipcRenderer } = require("electron");
        ipcRenderer.invoke("only-scoped");`,
    });
    const application = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(application.summary.ipc).toMatchObject({
      operations: 2,
      main_handlers: 1,
      renderer_transmissions: 1,
      dynamic_channel_operations: 0,
      paired_renderer_transmissions: 0,
      ambiguous_renderer_transmissions: 1,
    });
    const handlers = application.graph.nodes.filter(
      ({ kind }) => kind === "ipc-handler",
    );
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.observations[0]?.properties.receiver).toMatchObject({
      kind: "main-frame",
    });
    expect(
      application.graph.edges.filter(
        ({ evidence }) =>
          evidence.extractor.operation === "pair-ipc-literal-channel",
      ),
    ).toEqual([]);
  },
);
