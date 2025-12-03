# mcp-compiler

Transform plain TypeScript functions into an MCP server.

## Installation

```bash
npm install mcp-compiler
```

## Usage

```typescript
// tools.ts

/** add number */
export const add = async (num1: number, num2?: number) => num1 + (num2 ?? 0);

/** say hi to user */
export const sayHi = (name: string) => `Hi, ${name}`;

export const makeUser = (user: {
  /** Name of user */ name: string;
  /** Age of user */ age?: number;
}) => user;
```

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { compile, generateSchemas } from 'mcp-compiler';
import * as tools from './tools';

const pathToTools = `${__dirname}/tools.ts`;
const schemas = generateSchemas(pathToTools); // OK for dev, pre-build and load from file for release.
const compiled = compile({ tools, schemas });

const server = new McpServer(
  { name: 'My-Server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

for (const { name } of compiled.tools) {
  const zodSchemas = compiled.makeZodSchemas(name);
  const fn = compiled.callTool.bind(null, name);
  server.registerTool(name, zodSchemas, fn);
}

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP Server running on stdio`);
}

runServer().catch((error) => {
  console.error(`Fatal error running server:`, error);
  process.exit(1);
});
```

<details>
  <summary>Use with low level <code>Server</code> class for advanced use cases</summary>

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { compile, generateSchemas } from 'mcp-compiler';
import * as tools from './tools';

const pathToTools = `${__dirname}/tools.ts`;
const schemas = generateSchemas(pathToTools); // OK for dev, pre-build and load from file for release.
const compiled = compile({ tools, schemas });

const server = new Server(
  { name: 'My-Server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, compiled.ListToolsHandler);
server.setRequestHandler(CallToolRequestSchema, compiled.CallToolHandler);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP Server running on stdio`);
}

runServer().catch((error) => {
  console.error(`Fatal error running server:`, error);
  process.exit(1);
});
```

</details>
