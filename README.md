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
import { compile, generateSchemas } from 'mcp-compiler';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import tools from './tools.ts';

const pathToTools = `${__dirname}/tools.ts`;
const schemas = generateSchemas(__filename); // These should be generated during build time for release.
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
  console.error(`MCP Server '${name}' running on stdio`);
}

runServer().catch((error) => {
  console.error(`Fatal error running server '${name}':`, error);
  process.exit(1);
});
```
