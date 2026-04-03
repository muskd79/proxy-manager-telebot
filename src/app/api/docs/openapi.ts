export const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Proxy Manager API",
    version: "1.0.0",
    description:
      "REST API for managing proxies, Telegram users, and proxy requests. All endpoints return JSON with { success: boolean, data?, error?, message? } envelope.",
  },
  servers: [{ url: "/api", description: "Current server" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Supabase JWT token from admin login",
      },
      cronSecret: {
        type: "http",
        scheme: "bearer",
        description: "CRON_SECRET for scheduled jobs",
      },
    },
    schemas: {
      // --- Reusable response envelope ---
      SuccessResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string" },
          details: { type: "object", description: "Field-level validation errors" },
        },
      },
      PaginationMeta: {
        type: "object",
        properties: {
          total: { type: "integer" },
          page: { type: "integer" },
          pageSize: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },

      // --- Domain models ---
      Proxy: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          host: { type: "string" },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          type: { type: "string", enum: ["http", "https", "socks5"] },
          username: { type: "string", nullable: true },
          password: { type: "string", nullable: true, description: "Hidden for viewer role" },
          country: { type: "string", nullable: true },
          city: { type: "string", nullable: true },
          isp: { type: "string", nullable: true },
          status: { type: "string", enum: ["available", "assigned", "expired", "banned", "maintenance"] },
          speed_ms: { type: "integer", nullable: true },
          last_checked_at: { type: "string", format: "date-time", nullable: true },
          assigned_to: { type: "string", format: "uuid", nullable: true },
          assigned_at: { type: "string", format: "date-time", nullable: true },
          expires_at: { type: "string", format: "date-time", nullable: true },
          tags: { type: "array", items: { type: "string" }, nullable: true },
          notes: { type: "string", nullable: true },
          is_deleted: { type: "boolean" },
          deleted_at: { type: "string", format: "date-time", nullable: true },
          created_by: { type: "string", format: "uuid", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      TeleUser: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          telegram_id: { type: "integer" },
          username: { type: "string", nullable: true },
          first_name: { type: "string", nullable: true },
          last_name: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          status: { type: "string", enum: ["active", "blocked", "pending", "banned"] },
          approval_mode: { type: "string", enum: ["auto", "manual"] },
          max_proxies: { type: "integer" },
          rate_limit_hourly: { type: "integer" },
          rate_limit_daily: { type: "integer" },
          rate_limit_total: { type: "integer" },
          proxies_used_hourly: { type: "integer" },
          proxies_used_daily: { type: "integer" },
          proxies_used_total: { type: "integer" },
          language: { type: "string" },
          notes: { type: "string", nullable: true },
          is_deleted: { type: "boolean" },
          deleted_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      ProxyRequest: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tele_user_id: { type: "string", format: "uuid" },
          proxy_id: { type: "string", format: "uuid", nullable: true },
          proxy_type: { type: "string", enum: ["http", "https", "socks5"], nullable: true },
          country: { type: "string", nullable: true },
          status: { type: "string", enum: ["pending", "approved", "rejected", "auto_approved", "expired", "cancelled"] },
          approval_mode: { type: "string", enum: ["auto", "manual"], nullable: true },
          approved_by: { type: "string", format: "uuid", nullable: true },
          rejected_reason: { type: "string", nullable: true },
          requested_at: { type: "string", format: "date-time" },
          processed_at: { type: "string", format: "date-time", nullable: true },
          expires_at: { type: "string", format: "date-time", nullable: true },
          is_deleted: { type: "boolean" },
          deleted_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      ChatMessage: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tele_user_id: { type: "string", format: "uuid" },
          telegram_message_id: { type: "integer", nullable: true },
          direction: { type: "string", enum: ["incoming", "outgoing"] },
          message_text: { type: "string", nullable: true },
          message_type: { type: "string", enum: ["text", "command", "callback", "photo", "document", "system"] },
          raw_data: { type: "object", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      ActivityLog: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          actor_type: { type: "string", enum: ["admin", "tele_user", "system", "bot"] },
          actor_id: { type: "string", format: "uuid", nullable: true },
          action: { type: "string" },
          resource_type: { type: "string", nullable: true },
          resource_id: { type: "string", nullable: true },
          details: { type: "object", nullable: true },
          ip_address: { type: "string", nullable: true },
          user_agent: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Setting: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          key: { type: "string" },
          value: { type: "object" },
          description: { type: "string", nullable: true },
          updated_by: { type: "string", format: "uuid", nullable: true },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      ImportResult: {
        type: "object",
        properties: {
          total: { type: "integer" },
          imported: { type: "integer" },
          skipped: { type: "integer" },
          failed: { type: "integer" },
          errors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                line: { type: "integer" },
                raw: { type: "string" },
                reason: { type: "string" },
              },
            },
          },
        },
      },
      HealthCheckResult: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          alive: { type: "boolean" },
          speed_ms: { type: "integer" },
        },
      },
      TagEntry: {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "integer" },
        },
      },
      ProxyStats: {
        type: "object",
        properties: {
          total: { type: "integer" },
          byType: { type: "object", additionalProperties: { type: "integer" } },
          byStatus: { type: "object", additionalProperties: { type: "integer" } },
          byCountry: { type: "object", additionalProperties: { type: "integer" } },
          countries: { type: "array", items: { type: "string" } },
        },
      },
    },
  },

  paths: {
    // ================================================================
    // PROXIES
    // ================================================================
    "/proxies": {
      get: {
        summary: "List proxies",
        description: "Paginated, filterable proxy list. Viewers cannot see password field.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20, maximum: 500 } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Search by host" },
          { name: "type", in: "query", schema: { type: "string", enum: ["http", "https", "socks5"] } },
          { name: "status", in: "query", schema: { type: "string", enum: ["available", "assigned", "expired", "banned", "maintenance"] } },
          { name: "country", in: "query", schema: { type: "string" } },
          { name: "isp", in: "query", schema: { type: "string" }, description: "Filter by ISP (partial match)" },
          { name: "tags", in: "query", schema: { type: "string" }, description: "Comma-separated tags (overlaps filter)" },
          { name: "sortBy", in: "query", schema: { type: "string", default: "created_at" } },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "isDeleted", in: "query", schema: { type: "boolean", default: false }, description: "Show soft-deleted proxies" },
        ],
        responses: {
          200: {
            description: "Paginated list of proxies",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/PaginationMeta" },
                    {
                      type: "object",
                      properties: {
                        success: { type: "boolean" },
                        data: { type: "array", items: { $ref: "#/components/schemas/Proxy" } },
                      },
                    },
                  ],
                },
              },
            },
          },
          401: { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
      post: {
        summary: "Create proxy",
        description: "Create a single proxy. Requires admin or super_admin role.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["host", "port", "type"],
                properties: {
                  host: { type: "string", maxLength: 255 },
                  port: { type: "integer", minimum: 1, maximum: 65535 },
                  type: { type: "string", enum: ["http", "https", "socks5"] },
                  username: { type: "string", maxLength: 255, nullable: true },
                  password: { type: "string", maxLength: 255, nullable: true },
                  country: { type: "string", maxLength: 100, nullable: true },
                  city: { type: "string", maxLength: 100, nullable: true },
                  isp: { type: "string", maxLength: 255, nullable: true },
                  tags: { type: "array", items: { type: "string", maxLength: 50 }, maxItems: 20, nullable: true },
                  notes: { type: "string", maxLength: 1000, nullable: true },
                  expires_at: { type: "string", format: "date-time", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Proxy created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Proxy" } } } } } },
          400: { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          401: { description: "Unauthorized" },
          500: { description: "Server error" },
        },
      },
    },

    "/proxies/{id}": {
      get: {
        summary: "Get proxy by ID",
        description: "Returns a single proxy. Viewers cannot see password field.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Proxy details", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Proxy" } } } } } },
          404: { description: "Not found" },
          401: { description: "Unauthorized" },
        },
      },
      put: {
        summary: "Update proxy",
        description: "Partial update of a proxy. Supports restore from trash via is_deleted=false. Requires admin or super_admin.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  host: { type: "string", maxLength: 255 },
                  port: { type: "integer", minimum: 1, maximum: 65535 },
                  type: { type: "string", enum: ["http", "https", "socks5"] },
                  username: { type: "string", maxLength: 255, nullable: true },
                  password: { type: "string", maxLength: 255, nullable: true },
                  country: { type: "string", maxLength: 100, nullable: true },
                  city: { type: "string", maxLength: 100, nullable: true },
                  isp: { type: "string", maxLength: 255, nullable: true },
                  status: { type: "string", enum: ["available", "assigned", "maintenance"] },
                  tags: { type: "array", items: { type: "string", maxLength: 50 }, maxItems: 20, nullable: true },
                  notes: { type: "string", maxLength: 1000, nullable: true },
                  expires_at: { type: "string", format: "date-time", nullable: true },
                  assigned_to: { type: "string", format: "uuid", nullable: true },
                  is_deleted: { type: "boolean" },
                  deleted_at: { type: "string", format: "date-time", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Updated proxy", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Proxy" } } } } } },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          500: { description: "Server error" },
        },
      },
      delete: {
        summary: "Delete proxy",
        description: "Soft-delete by default. Pass ?permanent=true for hard delete. Requires admin or super_admin.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "permanent", in: "query", schema: { type: "boolean", default: false }, description: "Hard delete if true" },
        ],
        responses: {
          200: { description: "Proxy deleted" },
          404: { description: "Not found" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/proxies/check": {
      post: {
        summary: "Health check proxies",
        description: "Runs connectivity check on selected proxies. Dead proxies are set to maintenance status. Requires admin or super_admin.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["ids"],
                properties: {
                  ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1, maxItems: 500 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Health check results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { type: "array", items: { $ref: "#/components/schemas/HealthCheckResult" } },
                  },
                },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/proxies/import": {
      post: {
        summary: "Bulk import proxies",
        description: "Import up to 10,000 proxies. Duplicates are skipped. Requires admin or super_admin.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["proxies"],
                properties: {
                  proxies: {
                    type: "array",
                    minItems: 1,
                    maxItems: 10000,
                    items: {
                      type: "object",
                      required: ["host", "port"],
                      properties: {
                        host: { type: "string", maxLength: 255 },
                        port: { type: "integer", minimum: 1, maximum: 65535 },
                        type: { type: "string", enum: ["http", "https", "socks5"] },
                        username: { type: "string", maxLength: 255 },
                        password: { type: "string", maxLength: 255 },
                        country: { type: "string", maxLength: 100 },
                        line: { type: "integer", description: "Source line number" },
                        raw: { type: "string", description: "Original text line" },
                      },
                    },
                  },
                  type: { type: "string", enum: ["http", "https", "socks5"], description: "Default type for all" },
                  country: { type: "string", maxLength: 100, description: "Default country for all" },
                  tags: { type: "array", items: { type: "string", maxLength: 50 }, maxItems: 20 },
                  notes: { type: "string", maxLength: 1000 },
                  isp: { type: "string", maxLength: 255 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Import result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { $ref: "#/components/schemas/ImportResult" },
                  },
                },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/proxies/export": {
      get: {
        summary: "Export proxies",
        description: "Download all non-deleted proxies as CSV or JSON file. Viewers cannot see password field.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"], default: "csv" } },
        ],
        responses: {
          200: { description: "File download (CSV or JSON)" },
          401: { description: "Unauthorized" },
          404: { description: "No proxies found" },
        },
      },
    },

    "/proxies/stats": {
      get: {
        summary: "Proxy statistics",
        description: "Breakdown of proxy counts by type, status, and country.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Proxy statistics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { $ref: "#/components/schemas/ProxyStats" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/proxies/tags": {
      get: {
        summary: "List all tags",
        description: "Returns all unique tags with usage counts, sorted by most used.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Tag list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { type: "array", items: { $ref: "#/components/schemas/TagEntry" } },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
      put: {
        summary: "Manage tags",
        description: "Rename or delete a tag across all proxies. Requires admin or super_admin.",
        tags: ["Proxies"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    required: ["action", "from", "to"],
                    properties: {
                      action: { type: "string", enum: ["rename"] },
                      from: { type: "string", maxLength: 50 },
                      to: { type: "string", maxLength: 50 },
                    },
                  },
                  {
                    type: "object",
                    required: ["action", "tag"],
                    properties: {
                      action: { type: "string", enum: ["delete"] },
                      tag: { type: "string", maxLength: 50 },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          200: { description: "Number of proxies updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { updated: { type: "integer" } } } } } } } },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
        },
      },
    },

    // ================================================================
    // USERS (Telegram users)
    // ================================================================
    "/users": {
      get: {
        summary: "List Telegram users",
        description: "Paginated list of Telegram users with search and filter support.",
        tags: ["Users"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Search by username, first_name, last_name, or telegram_id" },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "blocked", "pending", "banned"] } },
          { name: "sortBy", in: "query", schema: { type: "string", default: "created_at" } },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "isDeleted", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: {
          200: {
            description: "Paginated list of users",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        data: { type: "array", items: { $ref: "#/components/schemas/TeleUser" } },
                        total: { type: "integer" },
                        page: { type: "integer" },
                        pageSize: { type: "integer" },
                        totalPages: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          500: { description: "Server error" },
        },
      },
      post: {
        summary: "Create Telegram user",
        description: "Manually register a Telegram user. Requires admin or super_admin.",
        tags: ["Users"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["telegram_id"],
                properties: {
                  telegram_id: { type: "integer", minimum: 1 },
                  username: { type: "string", maxLength: 255, nullable: true },
                  first_name: { type: "string", maxLength: 255, nullable: true },
                  last_name: { type: "string", maxLength: 255, nullable: true },
                  phone: { type: "string", maxLength: 50, nullable: true },
                  status: { type: "string", enum: ["active", "banned", "limited"] },
                  approval_mode: { type: "string", enum: ["manual", "auto"] },
                  max_proxies: { type: "integer", minimum: 0, maximum: 1000 },
                  rate_limit_hourly: { type: "integer", minimum: 0, maximum: 10000 },
                  rate_limit_daily: { type: "integer", minimum: 0, maximum: 100000 },
                  rate_limit_total: { type: "integer", minimum: 0, maximum: 1000000 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "User created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/TeleUser" }, message: { type: "string" } } } } } },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          500: { description: "Server error" },
        },
      },
    },

    "/users/{id}": {
      get: {
        summary: "Get user by ID",
        tags: ["Users"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "User details", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/TeleUser" } } } } } },
          404: { description: "Not found" },
          401: { description: "Unauthorized" },
        },
      },
      put: {
        summary: "Update user",
        description: "Partial update. Supports restore from trash via is_deleted=false. Requires admin or super_admin.",
        tags: ["Users"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["active", "banned", "limited"] },
                  approval_mode: { type: "string", enum: ["manual", "auto"] },
                  max_proxies: { type: "integer", minimum: 0, maximum: 1000 },
                  rate_limit_hourly: { type: "integer", minimum: 0, maximum: 10000 },
                  rate_limit_daily: { type: "integer", minimum: 0, maximum: 100000 },
                  rate_limit_total: { type: "integer", minimum: 0, maximum: 1000000 },
                  notes: { type: "string", maxLength: 2000, nullable: true },
                  username: { type: "string", maxLength: 255, nullable: true },
                  first_name: { type: "string", maxLength: 255, nullable: true },
                  last_name: { type: "string", maxLength: 255, nullable: true },
                  phone: { type: "string", maxLength: 50, nullable: true },
                  language: { type: "string", enum: ["en", "vi"] },
                  is_deleted: { type: "boolean" },
                  deleted_at: { type: "string", format: "date-time", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Updated user" },
          400: { description: "Validation error" },
          404: { description: "Not found" },
          401: { description: "Unauthorized" },
        },
      },
      delete: {
        summary: "Delete user",
        description: "Soft-delete by default. Pass ?permanent=true for hard delete. Requires admin or super_admin.",
        tags: ["Users"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "permanent", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: {
          200: { description: "User deleted" },
          404: { description: "Not found" },
          401: { description: "Unauthorized" },
        },
      },
    },

    // ================================================================
    // REQUESTS (proxy requests)
    // ================================================================
    "/requests": {
      get: {
        summary: "List proxy requests",
        description: "Paginated list with joins to tele_user, admin, and proxy. Supports multi-status filter (comma-separated).",
        tags: ["Requests"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" }, description: "Comma-separated statuses: pending, approved, rejected, auto_approved, expired, cancelled" },
          { name: "teleUserId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "proxyType", in: "query", schema: { type: "string", enum: ["http", "https", "socks5"] } },
          { name: "country", in: "query", schema: { type: "string" } },
          { name: "dateFrom", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "dateTo", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "sortBy", in: "query", schema: { type: "string", default: "requested_at" } },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "isDeleted", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: {
          200: {
            description: "Paginated list of proxy requests (with joined tele_user, admin, proxy)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        data: { type: "array", items: { $ref: "#/components/schemas/ProxyRequest" } },
                        total: { type: "integer" },
                        page: { type: "integer" },
                        pageSize: { type: "integer" },
                        totalPages: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
      post: {
        summary: "Create proxy request",
        description: "Create a manual proxy request on behalf of a user. Requires admin or super_admin.",
        tags: ["Requests"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tele_user_id"],
                properties: {
                  tele_user_id: { type: "string", format: "uuid" },
                  proxy_type: { type: "string", enum: ["http", "https", "socks5"], nullable: true },
                  country: { type: "string", maxLength: 100, nullable: true },
                  approval_mode: { type: "string", enum: ["manual", "auto"] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Request created" },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/requests/{id}": {
      get: {
        summary: "Get request by ID",
        description: "Returns request with joined tele_user, admin, and proxy details.",
        tags: ["Requests"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: { description: "Request details" },
          404: { description: "Not found" },
          401: { description: "Unauthorized" },
        },
      },
      put: {
        summary: "Update request (approve/reject/cancel)",
        description: "Approve (with proxy assignment or auto-assign), reject, or cancel a request. Approval uses atomic RPC to prevent race conditions. On approve, user is notified via Telegram. Requires admin or super_admin.",
        tags: ["Requests"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["approved", "rejected", "cancelled"] },
                  proxy_id: { type: "string", format: "uuid", nullable: true, description: "Required for approval unless auto_assign is true" },
                  rejected_reason: { type: "string", maxLength: 500, nullable: true },
                  auto_assign: { type: "boolean", description: "Auto-pick an available proxy matching request criteria" },
                  is_deleted: { type: "boolean" },
                  deleted_at: { type: "string", format: "date-time", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Request updated" },
          400: { description: "Validation error or no matching proxy for auto-assign" },
          404: { description: "Not found" },
          409: { description: "Conflict - proxy already assigned (race condition)" },
          401: { description: "Unauthorized" },
        },
      },
      delete: {
        summary: "Delete request",
        description: "Soft-delete (sets status to cancelled). Pass ?permanent=true for hard delete. Requires admin or super_admin.",
        tags: ["Requests"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "permanent", in: "query", schema: { type: "boolean", default: false } },
        ],
        responses: {
          200: { description: "Request deleted/cancelled" },
          404: { description: "Not found" },
          401: { description: "Unauthorized" },
        },
      },
    },

    // ================================================================
    // CHAT
    // ================================================================
    "/chat": {
      get: {
        summary: "List conversations or messages",
        description: "Without user_id: returns conversation list (latest message per user, sorted by recency). With user_id: returns paginated messages for that user.",
        tags: ["Chat"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "user_id", in: "query", schema: { type: "string", format: "uuid" }, description: "If provided, returns messages for this user" },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
        ],
        responses: {
          200: {
            description: "Conversation list or message list",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      description: "Conversation list (no user_id)",
                      properties: {
                        success: { type: "boolean" },
                        data: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              user: { $ref: "#/components/schemas/TeleUser" },
                              lastMessage: { $ref: "#/components/schemas/ChatMessage" },
                              unreadCount: { type: "integer" },
                            },
                          },
                        },
                      },
                    },
                    {
                      type: "object",
                      description: "Messages for a user (with user_id)",
                      properties: {
                        success: { type: "boolean" },
                        data: {
                          type: "object",
                          properties: {
                            messages: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } },
                            hasMore: { type: "boolean" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
      post: {
        summary: "Send message to user",
        description: "Send a Telegram message to a user. The message is also logged in chat_messages. Requires admin or super_admin.",
        tags: ["Chat"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tele_user_id", "message"],
                properties: {
                  tele_user_id: { type: "string", format: "uuid" },
                  message: { type: "string", minLength: 1, maxLength: 4096 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Message sent" },
          400: { description: "Validation error" },
          404: { description: "User not found" },
          401: { description: "Unauthorized" },
          500: { description: "Telegram API error" },
        },
      },
    },

    // ================================================================
    // SETTINGS
    // ================================================================
    "/settings": {
      get: {
        summary: "Get settings or admin list",
        description: "Pass ?type=admins to list all admins. Otherwise returns all settings. Requires super_admin.",
        tags: ["Settings"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "type", in: "query", schema: { type: "string", enum: ["admins"] }, description: "Set to 'admins' to list admin accounts" },
        ],
        responses: {
          200: { description: "Settings list or admin list", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: { $ref: "#/components/schemas/Setting" } } } } } } },
          401: { description: "Unauthorized (requires super_admin)" },
        },
      },
      put: {
        summary: "Update settings / manage admins / test bot",
        description: "Discriminated union on 'action' field. Requires super_admin.",
        tags: ["Settings"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    required: ["action", "settings"],
                    properties: {
                      action: { type: "string", enum: ["update_settings"] },
                      settings: { type: "object", additionalProperties: true, description: "Key-value pairs to upsert" },
                      applyToExisting: { type: "boolean", description: "If true, also update all existing users with new defaults" },
                    },
                  },
                  {
                    type: "object",
                    required: ["action", "adminId", "role"],
                    properties: {
                      action: { type: "string", enum: ["update_admin_role"] },
                      adminId: { type: "string", format: "uuid" },
                      role: { type: "string", enum: ["super_admin", "admin", "viewer"] },
                    },
                  },
                  {
                    type: "object",
                    required: ["action", "adminId", "is_active"],
                    properties: {
                      action: { type: "string", enum: ["toggle_admin_active"] },
                      adminId: { type: "string", format: "uuid" },
                      is_active: { type: "boolean" },
                    },
                  },
                  {
                    type: "object",
                    required: ["action"],
                    properties: {
                      action: { type: "string", enum: ["test_bot_connection"] },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          200: { description: "Action result" },
          400: { description: "Validation error or unknown action" },
          401: { description: "Unauthorized (requires super_admin)" },
        },
      },
      post: {
        summary: "Invite admin",
        description: "Create a new admin invitation. Requires super_admin.",
        tags: ["Settings"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action", "email"],
                properties: {
                  action: { type: "string", enum: ["invite_admin"] },
                  email: { type: "string", format: "email", maxLength: 255 },
                  role: { type: "string", enum: ["super_admin", "admin", "viewer"] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Admin invited" },
          400: { description: "Admin already exists or validation error" },
          401: { description: "Unauthorized (requires super_admin)" },
        },
      },
    },

    // ================================================================
    // STATS / ANALYTICS
    // ================================================================
    "/stats": {
      get: {
        summary: "Dashboard statistics",
        description: "Aggregated stats for proxies, users, and requests. Cached for 30 seconds.",
        tags: ["Stats"],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Dashboard stats",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      description: "Result from get_dashboard_stats RPC",
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    "/stats/analytics": {
      get: {
        summary: "Analytics data",
        description: "Daily analytics for the last 14 days (from get_analytics RPC). Cached for 30 seconds.",
        tags: ["Stats"],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Daily analytics array",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          date: { type: "string", description: "Formatted date (e.g. 'Mar 15')" },
                        },
                        additionalProperties: true,
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    // ================================================================
    // LOGS
    // ================================================================
    "/logs": {
      get: {
        summary: "Activity logs",
        description: "Paginated, filterable activity log. Supports comma-separated actions filter.",
        tags: ["Logs"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 25, maximum: 500 } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Search in details JSONB" },
          { name: "actorType", in: "query", schema: { type: "string", enum: ["admin", "tele_user", "system", "bot"] } },
          { name: "actorId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "action", in: "query", schema: { type: "string" }, description: "Single or comma-separated actions" },
          { name: "resourceType", in: "query", schema: { type: "string" } },
          { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
          { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
          { name: "sortBy", in: "query", schema: { type: "string", default: "created_at" } },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
        ],
        responses: {
          200: {
            description: "Paginated activity logs",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/PaginationMeta" },
                    {
                      type: "object",
                      properties: {
                        success: { type: "boolean" },
                        data: { type: "array", items: { $ref: "#/components/schemas/ActivityLog" } },
                      },
                    },
                  ],
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },

    // ================================================================
    // HEALTH
    // ================================================================
    "/health": {
      get: {
        summary: "Health check",
        description: "Public endpoint. Checks database connectivity. No auth required.",
        tags: ["Health"],
        responses: {
          200: {
            description: "System health",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["healthy", "degraded"] },
                    timestamp: { type: "string", format: "date-time" },
                    services: {
                      type: "object",
                      properties: {
                        database: { type: "string", enum: ["ok", "error"] },
                      },
                    },
                  },
                },
              },
            },
          },
          503: {
            description: "Service unavailable",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["unhealthy"] },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
