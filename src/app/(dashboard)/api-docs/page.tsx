"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  components: {
    schemas: Record<string, SchemaObject>;
    securitySchemes: Record<string, unknown>;
  };
  paths: Record<string, Record<string, EndpointDetails>>;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  enum?: string[];
  $ref?: string;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  required?: string[];
  nullable?: boolean;
  format?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  minLength?: number;
  default?: unknown;
  additionalProperties?: boolean | SchemaObject;
}

interface EndpointDetails {
  summary: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, unknown[]>>;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: SchemaObject;
    description?: string;
  }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema: SchemaObject }>;
  };
  responses?: Record<
    string,
    {
      description: string;
      content?: Record<string, { schema: SchemaObject }>;
    }
  >;
}

function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    get: "#22c55e",
    post: "#3b82f6",
    put: "#f59e0b",
    delete: "#ef4444",
    patch: "#8b5cf6",
  };
  return colors[method.toLowerCase()] || "#6b7280";
}

function getStatusColor(code: string): string {
  if (code.startsWith("2")) return "text-green-600 dark:text-green-400";
  if (code.startsWith("4")) return "text-yellow-600 dark:text-yellow-400";
  if (code.startsWith("5")) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function resolveRef(ref: string, spec: OpenApiSpec): SchemaObject | undefined {
  // #/components/schemas/Proxy -> components.schemas.Proxy
  const parts = ref.replace("#/", "").split("/");
  let current: unknown = spec;
  for (const part of parts) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current as SchemaObject | undefined;
}

function SchemaDisplay({
  schema,
  spec,
  depth = 0,
}: {
  schema: SchemaObject;
  spec: OpenApiSpec;
  depth?: number;
}) {
  if (depth > 4) return <span className="text-xs text-muted-foreground">...</span>;

  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop() || "";
    const resolved = resolveRef(schema.$ref, spec);
    if (!resolved) return <code className="text-xs">{refName}</code>;
    return (
      <details className="ml-2">
        <summary className="cursor-pointer text-xs font-medium text-blue-600 dark:text-blue-400">
          {refName}
        </summary>
        <SchemaDisplay schema={resolved} spec={spec} depth={depth + 1} />
      </details>
    );
  }

  if (schema.allOf) {
    return (
      <div className="space-y-1">
        {schema.allOf.map((s, i) => (
          <SchemaDisplay key={i} schema={s} spec={spec} depth={depth} />
        ))}
      </div>
    );
  }

  if (schema.oneOf) {
    return (
      <div className="space-y-1 ml-2">
        <span className="text-xs text-muted-foreground">One of:</span>
        {schema.oneOf.map((s, i) => (
          <div key={i} className="border-l border-dashed pl-2">
            <SchemaDisplay schema={s} spec={spec} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required || []);
    return (
      <div className="ml-2 space-y-0.5">
        {Object.entries(schema.properties).map(([name, prop]) => (
          <div key={name} className="text-xs">
            <code className="font-semibold">{name}</code>
            {required.has(name) && <span className="text-red-500 ml-0.5">*</span>}
            <span className="text-muted-foreground ml-1">
              {prop.type || (prop.$ref ? prop.$ref.split("/").pop() : "")}
              {prop.enum && ` [${prop.enum.join(" | ")}]`}
              {prop.nullable && "?"}
              {prop.format && ` (${prop.format})`}
            </span>
            {prop.description && (
              <span className="text-muted-foreground ml-1">- {prop.description}</span>
            )}
            {prop.type === "object" && prop.properties && (
              <SchemaDisplay schema={prop} spec={spec} depth={depth + 1} />
            )}
            {prop.type === "array" && prop.items && (
              <span className="text-muted-foreground">
                {" "}
                [{prop.items.type || prop.items.$ref?.split("/").pop() || "object"}]
              </span>
            )}
            {prop.$ref && (
              <span className="text-blue-600 dark:text-blue-400 ml-1">
                {prop.$ref.split("/").pop()}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (schema.type === "array" && schema.items) {
    return (
      <div className="ml-2">
        <span className="text-xs text-muted-foreground">Array of:</span>
        <SchemaDisplay schema={schema.items} spec={spec} depth={depth + 1} />
      </div>
    );
  }

  return (
    <span className="text-xs text-muted-foreground">
      {schema.type}
      {schema.enum && ` [${schema.enum.join(" | ")}]`}
      {schema.format && ` (${schema.format})`}
    </span>
  );
}

function EndpointCard({
  path,
  method,
  details,
  spec,
}: {
  path: string;
  method: string;
  details: EndpointDetails;
  spec: OpenApiSpec;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = getMethodColor(method);
  const bodySchema = details.requestBody?.content?.["application/json"]?.schema;

  return (
    <div
      className="border rounded-lg overflow-hidden"
      style={{ borderLeftWidth: "4px", borderLeftColor: color }}
    >
      <button
        className="w-full text-left p-3 hover:bg-muted/50 transition-colors flex items-center gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        <Badge
          className="text-white uppercase text-[10px] font-bold px-2 py-0.5 shrink-0"
          style={{ backgroundColor: color }}
        >
          {method}
        </Badge>
        <code className="text-sm font-mono">/api{path}</code>
        <span className="text-sm text-muted-foreground ml-auto hidden sm:inline">
          {details.summary}
        </span>
        <span className="text-muted-foreground text-xs">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>

      {expanded && (
        <div className="p-3 pt-0 border-t space-y-3 bg-muted/20">
          {details.description && (
            <p className="text-sm text-muted-foreground">{details.description}</p>
          )}

          {/* Auth */}
          {details.security && details.security.length > 0 && (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px]">
                Auth: {Object.keys(details.security[0])[0]}
              </Badge>
            </div>
          )}

          {/* Parameters */}
          {details.parameters && details.parameters.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Parameters
              </h4>
              <div className="space-y-1">
                {details.parameters.map((p) => (
                  <div key={p.name} className="text-xs flex gap-2 items-start">
                    <code className="font-semibold shrink-0">{p.name}</code>
                    {p.required && <span className="text-red-500">*</span>}
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                      {p.in}
                    </Badge>
                    <span className="text-muted-foreground">
                      {p.schema?.type}
                      {p.schema?.enum && ` [${p.schema.enum.join(" | ")}]`}
                      {p.schema?.default !== undefined && ` = ${String(p.schema.default)}`}
                    </span>
                    {p.description && (
                      <span className="text-muted-foreground">- {p.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Request Body */}
          {bodySchema && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Request Body {details.requestBody?.required && <span className="text-red-500">*</span>}
              </h4>
              <div className="bg-background rounded p-2 border">
                <SchemaDisplay schema={bodySchema} spec={spec} />
              </div>
            </div>
          )}

          {/* Responses */}
          {details.responses && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Responses
              </h4>
              <div className="space-y-1">
                {Object.entries(details.responses).map(([code, resp]) => (
                  <div key={code} className="text-xs flex gap-2 items-start">
                    <code className={`font-bold shrink-0 ${getStatusColor(code)}`}>{code}</code>
                    <span className="text-muted-foreground">{resp.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/docs")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setSpec)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load API spec: {error}</p>
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-4 w-96 bg-muted animate-pulse rounded" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  // Group endpoints by tag
  const tagGroups = new Map<string, Array<{ path: string; method: string; details: EndpointDetails }>>();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, details] of Object.entries(methods)) {
      const tag = details.tags?.[0] || "Other";
      if (!tagGroups.has(tag)) tagGroups.set(tag, []);
      tagGroups.get(tag)!.push({ path, method, details });
    }
  }

  const tags = Array.from(tagGroups.keys());

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{spec.info.title}</h1>
        <p className="text-muted-foreground mt-1">{spec.info.description}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline">v{spec.info.version}</Badge>
          <Badge variant="outline">OpenAPI {spec.openapi}</Badge>
          <Badge variant="secondary">
            {Object.values(spec.paths).reduce(
              (acc, methods) => acc + Object.keys(methods).length,
              0
            )}{" "}
            endpoints
          </Badge>
        </div>
      </div>

      {/* Tabs by tag group */}
      <Tabs defaultValue={tags[0]} className="w-full">
        <ScrollArea className="w-full">
          <TabsList className="inline-flex w-auto">
            {tags.map((tag) => (
              <TabsTrigger key={tag} value={tag} className="text-xs sm:text-sm">
                {tag}
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1 py-0">
                  {tagGroups.get(tag)!.length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        {tags.map((tag) => (
          <TabsContent key={tag} value={tag} className="space-y-2 mt-4">
            {tagGroups.get(tag)!.map(({ path, method, details }) => (
              <EndpointCard
                key={`${method}-${path}`}
                path={path}
                method={method}
                details={details}
                spec={spec}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>

      {/* Schemas reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Schemas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(spec.components.schemas).map(([name, schema]) => (
            <details key={name} className="border rounded p-2">
              <summary className="cursor-pointer font-mono text-sm font-semibold">{name}</summary>
              <div className="mt-2">
                <SchemaDisplay schema={schema} spec={spec} />
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
