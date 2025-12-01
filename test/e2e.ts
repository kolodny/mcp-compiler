import { test } from 'node:test';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
import { compile, generateSchemas } from '../src/index';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export const addV1 = (a: number, b: number) => a + b;
export const addV2 = ({ a, b }: { a: number; b: number }) => a + b;
export const sayHi = (name: string) => `Hi, ${name}!`;
export const sum = (s: number, ...r: number[]) => r.reduce((a, n) => a + n, s);
export const restSum = (...ns: number[]) => ns.reduce((a, n) => a + n);
export const concat = (a: string, b: string) => a + b;
export const makeUser = async (id: string, age: number) => ({ id, age });

export const returnsRecord = () => {
  const record: Record<string, number> = { a: 1, b: 2 };
  return record;
};

test(basename(__filename), async () => {
  const tools = await import(__filename);

  const common = { start: async () => {}, close: async () => {} };
  const clientTransport: Transport = {
    ...common,
    send: async (message) => serverTransport.onmessage?.(message),
  };

  const serverTransport: Transport = {
    ...common,
    send: async (message) => clientTransport.onmessage?.(message),
  };

  const compiled = compile({ tools, schemas: generateSchemas(__filename) });
  const server = new Server(
    { name: 'Server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, compiled.ListToolsHandler);
  server.setRequestHandler(CallToolRequestSchema, compiled.CallToolHandler);

  await server.connect(serverTransport);
  console.error(`MCP Server running on stdio`);

  const client = new Client({
    name: 'Client',
    version: '1.0.0',
  });

  await client.connect(clientTransport);
  const listTools = await client.listTools();
  assert.deepStrictEqual(
    listTools.tools.map((t) => t.name).sort(),
    [
      'addV1',
      'addV2',
      'sayHi',
      'sum',
      'restSum',
      'concat',
      'makeUser',
      'returnsRecord',
    ].sort()
  );

  const checkStructured = async (name: string, params: any, expected: any) => {
    const result = await client.callTool({ name, arguments: params });
    assert.deepStrictEqual(result.structuredContent, expected);
  };

  await checkStructured('addV1', { a: 4, b: 5 }, { result: 9 });
  await checkStructured('addV2', { a: 4, b: 5 }, { result: 9 });
  await checkStructured('sayHi', { name: 'Bob' }, { result: 'Hi, Bob!' });
  await checkStructured('sum', { s: 1, r: [2, 3, 4, 5] }, { result: 15 });
  await checkStructured('restSum', { arg0: [1, 2, 3, 4, 5] }, { result: 15 });
  await checkStructured('concat', { a: 'H, ', b: 'W!' }, { result: 'H, W!' });
  await checkStructured('concat', { b: 'W!', a: 'H, ' }, { result: 'H, W!' });
  await checkStructured('makeUser', { id: 'AB', age: 9 }, { id: 'AB', age: 9 });

  const addV1Error = await client.callTool({
    name: 'addV1',
    arguments: { a: 4, b: '5' },
  });
  assert.strictEqual(addV1Error.isError, true);
  assert.match(JSON.stringify(addV1Error.content), /#\/properties\/b\/type/);
  assert.match(JSON.stringify(addV1Error.content), /must be number/);

  const addV1Text = await client.callTool({
    name: 'addV1',
    arguments: { a: 4, b: 5 },
  });
  assert.ok(!addV1Text.isError, 'Expected no error for valid call');
  assert.partialDeepStrictEqual(addV1Text.content, [{ text: '{"result":9}' }]);

  const makeUser = await client.callTool({
    name: 'makeUser',
    arguments: { id: 'AB', age: 9 },
  });
  assert.ok(!makeUser.isError, 'Expected no error for valid call');
  const content = '{"id":"AB","age":9}';
  assert.partialDeepStrictEqual(makeUser.content, [{ text: content }]);

  const recordTool = listTools.tools.find((t) => t.name === 'returnsRecord');
  assert.ok(
    recordTool?.outputSchema?.definitions!,
    'record tool should have definitions'
  );
});
