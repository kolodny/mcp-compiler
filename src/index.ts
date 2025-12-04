import { generateSchemas } from 'ts2schema';
import Ajv from 'ajv';
import type * as Z4 from 'zod/v4';
import type {
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
  z: _z,
}: {
  /** Main import: `import * as tools from './tools'` */
  tools: Record<string, any>;
  /** Generated schemas, should be saved when bundling since reflection may not be available */
  schemas: ReturnType<typeof generateSchemas>;
  /** Should all tool calls be validated against their input schemas */
  validateCalls?: boolean;
  /** AJV instance for JSON schema validation, used to change validation behavior */
  ajv?: Ajv;
  z?: typeof Z4;
}) => {
  const wrappedResults = new Set<string>();
  const toolsList: ListToolsResult['tools'] = Object.entries(schemas.fns).map(
    ([name, definition]) => {
      const result = definition.properties?.['result']!;
      const isObject = typeof result === 'object' && result.type === 'object';
      let outputSchema: any = result;
      const inputSchema = definition.properties?.['params'] as any;
      if (!isObject) {
        wrappedResults.add(name);
        outputSchema = {
          type: 'object',
          properties: { result },
          required: ['result'],
          additionalProperties: false,
        };
      }
      if (definition.definitions) {
        if (inputSchema) inputSchema.definitions = definition.definitions;
        if (outputSchema) outputSchema.definitions = definition.definitions;
      }
      const { description, definitions } = definition;
      return { name, inputSchema, outputSchema, definitions, description };
    }
  );

  const makeZodSchemas = (name: string, z: typeof Z4 | undefined = _z) => {
    if (!z) throw new Error('Zod instance not provided');
    const tool = toolsList.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);

    const makeZod = (props: Record<string, any>) => {
      const keys = Object.keys(props ?? {});
      return Object.fromEntries(keys.map((k) => [k, z.any().optional()]));
    };

    const input = makeZod(tool.inputSchema?.properties ?? {});
    const output = tool.outputSchema
      ? makeZod(tool.outputSchema?.properties ?? {})
      : undefined;

    const inputSchema = z.object(input).superRefine((data, ctx) => {
      const valid = validate(name, data);
      if (!valid.valid) {
        for (const error of valid.errors || []) {
          const path = error.instancePath.split('/').slice(1).join('.');

          const message = error.message || 'Invalid value';
          if (path) ctx.addIssue({ code: 'custom', message, path: [path] });
          else ctx.addIssue({ code: 'custom', message });
        }
      }
    });

    const outputSchema = output
      ? z.object(output).register(z.globalRegistry, tool.outputSchema!)
      : undefined;

    inputSchema.register(z.globalRegistry, tool.inputSchema);

    return { inputSchema, outputSchema };
  };

  const validate = (name: string, params: any) => {
    const tool = toolsList.find((t) => t.name === name);
    const inputSchema = tool!.inputSchema;

    const validate = ajv.compile(inputSchema);
    const valid = validate(params);
    return { valid, ...validate };
  };

  /** Raw function apply, handles object and array param mapping, does NOT return an LLM shaped response. */
  const apply = async (name: string, params: any) => {
    const tool = toolsList.find((t) => t.name === name);
    const inputSchema = tool!.inputSchema;

    const isUnary = schemas.unaryFns.includes(name);
    let result: any;
    if (isUnary) result = await tools[name](params);
    else {
      const args: Record<string, unknown> = {};
      const props = inputSchema.properties;

      const arity = tools[name].length; // to get correct arity in TS
      const keys = Object.keys(props ?? {});
      const values: any[] = [];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        const isRest = arity === i;
        const value = params[key];
        if (isRest) values.push(...(value as any[]));
        else values.push(value);
      }

      result = await tools[name](...values);
    }
    return wrappedResults.has(name) ? { result } : result;
  };

  const ListToolsHandler = (): ListToolsResult => ({ tools: toolsList });

  /** Calls the function, and returns the LLM shaped response. */
  const callTool = async (
    name: string,
    args: unknown
  ): Promise<CallToolResult> => {
    try {
      const result = await apply(name, args);
      const raw = wrappedResults.has(name) && typeof result.result === 'string';
      const text = raw ? result.result : JSON.stringify(result, null, 2);
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

  const CallToolHandler = async ({
    params: { name, arguments: args },
  }: CallToolRequest): Promise<CallToolResult> => {
    if (validateCalls) {
      const { valid, errors } = validate(name, args);

      if (!valid) {
        const text = JSON.stringify(errors);
        return { isError: true, content: [{ type: 'text', text }] };
      }
    }
    return callTool(name, args);
  };

  return {
    tools: toolsList,
    validate,
    apply,
    callTool,
    CallToolHandler,
    ListToolsHandler,
    makeZodSchemas,
  };
};
