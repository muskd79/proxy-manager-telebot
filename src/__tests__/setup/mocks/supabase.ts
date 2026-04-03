import { vi } from "vitest";

/**
 * Create a chainable Supabase query mock.
 * Usage: const mock = createChainableMock({ data: [...], error: null });
 */
export function createChainableMock(
  resolvedValue: { data?: any; error?: any; count?: number | null } = {
    data: null,
    error: null,
  }
) {
  const mock: any = vi.fn().mockImplementation(() => mock);
  // All chainable methods return the mock itself
  const methods = [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "eq",
    "neq",
    "gt",
    "lt",
    "gte",
    "lte",
    "in",
    "not",
    "is",
    "ilike",
    "overlaps",
    "order",
    "limit",
    "range",
    "single",
    "maybeSingle",
    "then",
  ];

  for (const method of methods) {
    if (method === "single" || method === "maybeSingle") {
      mock[method] = vi.fn().mockResolvedValue(resolvedValue);
    } else if (method === "then") {
      mock[method] = vi.fn((resolve: Function) => resolve(resolvedValue));
    } else {
      mock[method] = vi.fn().mockReturnValue(mock);
    }
  }

  // Allow count to be returned with select
  mock._resolvedValue = resolvedValue;
  return mock;
}

/**
 * Create a mock Supabase admin client.
 */
export function createMockSupabaseAdmin() {
  const fromMocks = new Map<string, any>();

  return {
    from: vi.fn((table: string) => {
      if (!fromMocks.has(table)) {
        fromMocks.set(table, createChainableMock());
      }
      return fromMocks.get(table);
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    // Helper to configure table-specific mocks
    _mockTable(table: string, resolved: any) {
      fromMocks.set(table, createChainableMock(resolved));
      return this;
    },
    _getMock(table: string) {
      return fromMocks.get(table);
    },
  };
}
