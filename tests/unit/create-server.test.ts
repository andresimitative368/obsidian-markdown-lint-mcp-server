import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/create-server.js';

/**
 * Connection test: drives the server over an in-memory transport exactly the way
 * an MCP client (Claude Code) drives it over stdio — initialize handshake, tool
 * discovery, tool call — without spawning a process or touching Docker. This is
 * the regression guard for "the server fails to connect": if the bootstrap or a
 * tool registration breaks, this goes red.
 */
async function connectedClient(): Promise<Client> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('createServer (MCP wiring)', () => {
  it('completes the initialize handshake and lists all four tools', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'extract_mermaid_from_svg',
      'lint_markdown',
      'render_mermaid_diagrams',
      'validate_front_matter',
    ]);
    await client.close();
  });

  it('calls lint_markdown over the transport and returns lint errors', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'lint_markdown',
      arguments: { content: '# Heading\n\n### Skipped Level\n' },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');
    const parsed = JSON.parse(content[0].text);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(typeof parsed.fixed_content).toBe('string');
    await client.close();
  });
});
