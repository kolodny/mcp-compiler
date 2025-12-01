import { generateSchemas } from 'ts2schema';
import Ajv from 'ajv';
import type {
  ListToolsRequest,
  ListToolsResult,
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
export { generateSchemas };

export const compile = ({
  tools,
  schemas,
  validateCalls = true,
  ajv = new Ajv(),
}: {
  /** Main import: `import * as tools from './tools'` */
  tools: Record<string, any>;
  /** Generated schemas, should be saved when bundling since reflection may not be available */
  schemas: ReturnType<typeof generateSchemas>;
  /** Should all tool calls be validated against their input schemas */
  validateCalls?: boolean;
  /** AJV instance for JSON schema validation, used to change validation behavior */
  ajv?: Ajv;
}) => {
  const wrappedResults = new Set<string>();
  const toolsList: ListToolsResult['tools'] = Object.entries(schemas.fns).map(
    ([name, definition]) => {
      const result = definition.properties?.['result']!;
      const isObject = typeof result === 'object' && result.type === 'object';
      let outputSchema: any = result;
      if (!isObject) {
        wrappedResults.add(name);
        outputSchema = {
          type: 'object',
          properties: { result },
          required: ['result'],
          additionalProperties: false,
        };
      }
      return {
        name,
        inputSchema: definition.properties?.['params'] as never,
        outputSchema,
        description: definition.description,
      };
    }
  );

  const validate = (name: string, params: any) => {
    const tool = toolsList.find((t) => t.name === name);
    const inputSchema = tool!.inputSchema;

    const validate = ajv.compile(inputSchema);
    const valid = validate(params);
    return { valid, ...validate };
  };

  const call = async (name: string, params: any) => {
    const tool = toolsList.find((t) => t.name === name);
    const inputSchema = tool!.inputSchema;

    const isUnary = schemas.unaryFns.includes(name);
    let result: any;
    if (isUnary) result = await tools[name](params);
    else {
      const args: Record<string, unknown> = {};
      const props = inputSchema.properties;

      for (const key of Object.keys(props ?? {})) args[key] = params[key];

      result = await tools[name](...Object.values(args).flat());
    }
    return wrappedResults.has(name) ? { result } : result;
  };

  const ListToolsHandler = async (
    request: ListToolsRequest
  ): Promise<ListToolsResult> => {
    return { tools: toolsList };
  };

  const CallToolHandler = async (
    request: CallToolRequest
  ): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    if (validateCalls) {
      const { valid, errors } = validate(name, args);

      if (!valid) {
        const text = JSON.stringify(errors);
        return { isError: true, content: [{ type: 'text', text }] };
      }
    }

    try {
      const result = await call(name, args);
      const text = JSON.stringify(result);
      return { content: [{ type: 'text', text }], structuredContent: result };
    } catch (error: any) {
      const text = JSON.stringify({
        message: error?.message,
        stack: error?.stack,
        ...error,
      });
      return { isError: true, content: [{ type: 'text', text }] };
    }
  };

  return {
    tools: toolsList,
    validate,
    call,
    CallToolHandler,
    ListToolsHandler,
  };
};
