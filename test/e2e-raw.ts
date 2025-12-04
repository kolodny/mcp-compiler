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

export const noParams = () => 123;

test(basename(__filename), async () => {
  const tools = await import(__filename);

  const empty = async () => {};
  const common: Transport = { start: empty, close: empty, send: empty };
  const clientTransport = { ...common };
  const serverTransport = { ...common };
  clientTransport.send = async (m) => serverTransport.onmessage?.(m);
  serverTransport.send = async (m) => clientTransport.onmessage?.(m);

  const schemas = generateSchemas(__filename);
  const compiled = compile({ tools, schemas });

  const server = new Server(
    { name: 'Server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  const client = new Client({ name: 'Client', version: '1.0.0' });

  server.setRequestHandler(ListToolsRequestSchema, compiled.ListToolsHandler);
  server.setRequestHandler(CallToolRequestSchema, compiled.CallToolHandler);

  await server.connect(serverTransport);
  console.error(`MCP Server running on stdio`);

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
      'noParams',
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
  assert.partialDeepStrictEqual(addV1Text.content, [
    { text: '{\n  "result": 9\n}' },
  ]);

  const makeUser = await client.callTool({
    name: 'makeUser',
    arguments: { id: 'AB', age: 9 },
  });
  assert.ok(!makeUser.isError, 'Expected no error for valid call');
  const content = JSON.stringify({ id: 'AB', age: 9 }, null, 2);
  assert.partialDeepStrictEqual(makeUser.content, [{ text: content }]);

  const recordTool = listTools.tools.find((t) => t.name === 'returnsRecord');
  assert.ok(
    recordTool?.outputSchema?.definitions!,
    'record tool should have definitions'
  );

  const noParams = listTools.tools.find((t) => t.name === 'noParams');
  assert.deepEqual(noParams?.inputSchema, {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  });
});
