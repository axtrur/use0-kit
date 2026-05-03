export type McpRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown> & { name?: string; arguments?: Record<string, unknown> };
};

export function mcpTools() {
  return [
    {
      name: "use0.list",
      description: "List use0-kit resources from the current or scoped root.",
      inputSchema: {
        type: "object",
        properties: {
          selectors: { type: "array", items: { type: "string" } },
          scope: { type: "string" },
          effective: { type: "boolean" },
          agent: { type: "string" }
        }
      }
    },
    {
      name: "use0.info",
      description: "Explain one use0-kit resource selector.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" }
        },
        required: ["selector"]
      }
    },
    {
      name: "use0.explain",
      description: "Explain one use0-kit selector across scopes.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          scope: { type: "string" },
          agent: { type: "string" },
          json: { type: "boolean" }
        },
        required: ["selector"]
      }
    },
    {
      name: "use0.plan",
      description: "Build a materialization plan for the current or scoped root.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string" },
          agent: { type: "string" },
          json: { type: "boolean" },
          materialize: { type: "string" }
        }
      }
    },
    {
      name: "use0.apply",
      description: "Apply the current manifest to managed agent outputs.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string" },
          agent: { type: "string" },
          verify: { type: "boolean" },
          backup: { type: "boolean" }
        }
      }
    },
    {
      name: "use0.sync",
      description: "Sync declared parents into the current or scoped root and optionally apply.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string" },
          agent: { type: "string" },
          verify: { type: "boolean" },
          backup: { type: "boolean" },
          materialize: { type: "string" }
        }
      }
    },
    {
      name: "use0.doctor",
      description: "Run use0-kit doctor checks.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string" },
          fix: { type: "boolean" }
        }
      }
    }
  ];
}
