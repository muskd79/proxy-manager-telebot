// ============================================================
// API Types
// ============================================================

import type {
  ProxyType,
  ProxyStatus,
  TeleUserStatus,
  RequestStatus,
  ActorType,
} from "./database";

// ----------------------
// Generic response types
// ----------------------

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Canonical API response envelope.
 *
 * Wave 27 craft review [code-reviewer #6, MEDIUM] — added `details`
 * to the type because 7+ routes already return it on validation
 * errors (Zod field errors via `.flatten().fieldErrors`). Pre-fix
 * client code typing fetch responses as `ApiResponse<T>` silently
 * lost field-level error details — `requests/route.ts` workaround
 * `satisfies ApiResponse<never> & { details: unknown }` was a
 * one-off patch around the gap.
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  /** Free-text human-readable message (e.g. "Quá nhiều lần thử"). */
  message?: string;
  /**
   * Structured details — most commonly Zod's
   * `flatten().fieldErrors`: `{ fieldName: ["error msg", …] }`,
   * but routes also use it for context payloads
   * (e.g., `{ reclaimed_proxies: number }`). Typed as `unknown` so
   * each route defines its own shape via intersection at the
   * NextResponse.json call site without fighting the canonical type.
   */
  details?: unknown;
}

// ----------------------
// Filter types
// ----------------------

export interface ProxyFilters {
  search?: string;
  type?: ProxyType;
  /** Wave 22J — network classification filter. */
  networkType?:
    | "isp"
    | "datacenter_ipv4"
    | "datacenter_ipv6"
    | "residential"
    | "mobile"
    | "static_residential";
  /**
   * Wave 22Z + 22AB — accepts DB enum + 2 synthetic filter-only
   * values:
   *   "hidden"        → server: WHERE hidden = true (cascade trigger
   *                     mirrors category.is_hidden into proxies.hidden,
   *                     so this single column covers both manual and
   *                     cascade hides).
   *   "expiring_soon" → server: WHERE NOW < expires_at <= NOW + 3d
   *                     AND hidden = false AND status NOT IN ('banned').
   *
   * Real DB enum values still pass through with the default
   * hidden=false guard.
   */
  status?: ProxyStatus | "hidden" | "expiring_soon";
  /** Wave 22J — separate filter for "Còn hạn / Hết hạn / Sắp hết hạn". */
  expiryStatus?: "valid" | "expiring_soon" | "expired" | "never";
  country?: string;
  assignedTo?: string;
  // Wave 22C: tags filter removed (use category_id instead).
  categoryId?: string;
  isp?: string;
  /** Wave 22G — show proxies hidden by category cascade. */
  includeHidden?: boolean;
  /**
   * Wave 26-C — filter to a single import batch UUID. Set when admin
   * clicks "Xem lô vừa import" on the post-import success toast or
   * loads /proxies?import_batch_id=… directly. Maps server-side to
   * `proxies.import_batch_id = …`.
   */
  importBatchId?: string;
  isDeleted?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface UserFilters {
  search?: string;
  status?: TeleUserStatus;
  isDeleted?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface RequestFilters {
  search?: string;
  /**
   * Comma-separated for multi-select (server splits on `,` and uses
   * .in("status", arr) when length > 1).
   */
  status?: RequestStatus | string;
  teleUserId?: string;
  proxyType?: ProxyType;
  country?: string;
  /**
   * Wave 26-D-post1 — filter by how the request was approved/handled:
   *   - "auto": only auto-approved requests (system fast path)
   *   - "manual": only admin-approved/rejected requests
   * Maps to `proxy_requests.approval_mode` column.
   */
  approvalMode?: "auto" | "manual";
  isDeleted?: boolean;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface LogFilters {
  search?: string;
  actorType?: ActorType;
  actorId?: string;
  action?: string;
  resourceType?: string;
  /**
   * Wave 26-D-pre1 — filter activity_logs by the resource the event
   * targeted (e.g. all logs for proxy X). Lets the proxy detail timeline
   * fetch only the events relevant to one proxy without dragging the
   * full audit log over the wire. Indexed by `idx_logs_resource
   * (resource_type, resource_id)` (mig 002).
   */
  resourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// ----------------------
// Dashboard
// ----------------------

export interface DashboardStats {
  totalProxies: number;
  availableProxies: number;
  assignedProxies: number;
  expiredProxies: number;
  totalUsers: number;
  activeUsers: number;
  pendingUsers: number;
  blockedUsers: number;
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  todayRequests: number;
  todayApproved: number;
}

// ----------------------
// Import
// ----------------------

export interface ImportProxyResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{
    line: number;
    raw: string;
    reason: string;
  }>;
  /**
   * Wave 26-C — UUID stamped on every imported row's `import_batch_id`
   * column. The import wizard surfaces a "Xem lô vừa import" link
   * pointing at /proxies?import_batch_id=<id> so admins can verify
   * the batch end-to-end without eyeballing 200 host:port pairs.
   */
  import_batch_id?: string;
}
