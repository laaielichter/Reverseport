// Plugin entry for the MCP server. Plugins are installed into a cache folder that is replaced on update,
// so ReversePort's workspace (plans, extracted files, reports) defaults to ~/.reverseport, never the plugin
// folder. Set REVERSEPORT_HOME to put it elsewhere (e.g. a roomier drive).
import { isMainModule } from '../src/main-module.mjs';

export async function main() {
  // A plugin installed from git has no built engine. REVERSEPORT_ENGINE_FETCH=npx lets it run the published engine
  // through npx instead (downloads the package once); without it the server starts with ReversePort's own tools and
  // says how to add the engine.
  if (process.env.REVERSEPORT_ENGINE_FETCH === 'npx' && !process.env.REVERSEPORT_ENGINE_COMMAND) {
    const { engineCommand } = await import('../src/relay.mjs');
    const { VERSION } = await import('../src/tools.mjs');
    if (engineCommand().missing) process.env.REVERSEPORT_ENGINE_COMMAND = JSON.stringify(process.platform === 'win32' ? ['cmd', '/c', 'npx', '-y', `reverseport@${VERSION}`, 'engine', 'mcp'] : ['npx', '-y', `reverseport@${VERSION}`, 'engine', 'mcp']);
  }
  process.env.REVERSEPORT_VIA_PLUGIN ??= '1';
  await import('../mcp.mjs');
}

if (isMainModule(import.meta.url)) await main();
