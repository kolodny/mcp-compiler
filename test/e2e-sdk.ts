import { test } from 'node:test';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
import { compile, generateSchemas } from '../src/index';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import * as Z4 from 'zod/v4';

export const addV1 = (a: number, b: number) => a + b;
export const addV2 = ({ a, b }: { a: number; b: number }) => a + b;
export const makeUser = async (id: string, age: number) => ({ id, age });

test(basename(__filename), async () => {
  const tools = await import(__filename);

  const empty = async () => {};
  const common: Transport = { start: empty, close: empty, send: empty };
  const clientTransport = { ...common };
  const serverTransport = { ...common };
  clientTransport.send = async (m) => serverTransport.onmessage?.(m);
  serverTransport.send = async (m) => clientTransport.onmessage?.(m);

  const server = new McpServer(
    { name: 'Server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  const client = new Client({ name: 'Client', version: '1.0.0' });

  const schemas = generateSchemas(__filename);
  const compiled = compile({ tools, schemas, z: Z4 });

  for (const { name } of compiled.tools) {
    const zodSchemas = compiled.makeZodSchemas(name);
    const fn = compiled.callTool.bind(null, name);
    server.registerTool(name, zodSchemas, fn);
  }

  await server.connect(serverTransport);
  console.error(`MCP Server running on stdio`);

  await client.connect(clientTransport);
  const listTools = await client.listTools();
  assert.deepStrictEqual(
    listTools.tools.map((t) => t.name).sort(),
    ['addV1', 'addV2', 'makeUser'].sort()
  );
  const checkStructured = async (name: string, params: any, expected: any) => {
    const result = await client.callTool({ name, arguments: params });
    assert.deepStrictEqual(result.structuredContent, expected);
  };

  await checkStructured('addV1', { a: 4, b: 5 }, { result: 9 });
  await checkStructured('addV2', { a: 4, b: 5 }, { result: 9 });
  const addV1Error = await client.callTool({
    name: 'addV1',
    arguments: { a: 4, b: '5' },
  });
  const error = (addV1Error.content as any)?.[0]?.text;
  assert.strictEqual(addV1Error.isError, true);
  assert.match(error, /"b"/);
  assert.match(error, /must be number/);
});
