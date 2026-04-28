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

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
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
  status?: ProxyStatus;
  /** Wave 22J — separate filter for "Còn hạn / Hết hạn / Sắp hết hạn". */
  expiryStatus?: "valid" | "expiring_soon" | "expired" | "never";
  country?: string;
  assignedTo?: string;
  // Wave 22C: tags filter removed (use category_id instead).
  categoryId?: string;
  isp?: string;
  /** Wave 22G — show proxies hidden by category cascade. */
  includeHidden?: boolean;
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
  status?: RequestStatus;
  teleUserId?: string;
  proxyType?: ProxyType;
  country?: string;
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
}
