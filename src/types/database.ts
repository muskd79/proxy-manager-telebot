// ============================================================
// Supabase Database Types
// Generated from 001_create_tables.sql schema
// ============================================================

// ----------------------
// Enum types (for use in application code)
// ----------------------

export enum AdminRole {
  SuperAdmin = "super_admin",
  Admin = "admin",
  Viewer = "viewer",
}

export enum ProxyType {
  HTTP = "http",
  HTTPS = "https",
  SOCKS5 = "socks5",
}

export enum ProxyStatus {
  Available = "available",
  Assigned = "assigned",
  Expired = "expired",
  Banned = "banned",
  Maintenance = "maintenance",
}

export enum TeleUserStatus {
  Active = "active",
  Blocked = "blocked",
  Pending = "pending",
  Banned = "banned",
}

export enum ApprovalMode {
  Auto = "auto",
  Manual = "manual",
}

export enum RequestStatus {
  Pending = "pending",
  Approved = "approved",
  Rejected = "rejected",
  AutoApproved = "auto_approved",
  Expired = "expired",
  Cancelled = "cancelled",
}

export enum ChatDirection {
  Incoming = "incoming",
  Outgoing = "outgoing",
}

export enum MessageType {
  Text = "text",
  Command = "command",
  Callback = "callback",
  Photo = "photo",
  Document = "document",
  System = "system",
}

export enum ActorType {
  Admin = "admin",
  TeleUser = "tele_user",
  System = "system",
  Bot = "bot",
}

// ----------------------
// Row interfaces (using string literal unions for Supabase compatibility)
// ----------------------

export interface Admin {
  id: string;
  email: string;
  full_name: string | null;
  role: "super_admin" | "admin" | "viewer";
  is_active: boolean;
  language: string;
  telegram_id: number | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  login_count: number;
  created_at: string;
  updated_at: string;
}

export interface TeleUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: "active" | "blocked" | "pending" | "banned";
  approval_mode: "auto" | "manual";
  max_proxies: number;
  rate_limit_hourly: number;
  rate_limit_daily: number;
  rate_limit_total: number;
  proxies_used_hourly: number;
  proxies_used_daily: number;
  proxies_used_total: number;
  hourly_reset_at: string | null;
  daily_reset_at: string | null;
  language: string;
  notes: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** AUP gate — set when the user explicitly accepts the Acceptable Use Policy. */
  aup_accepted_at: string | null;
  /** Version token of the AUP the user accepted (matches AUP_VERSION constant). */
  aup_version: string | null;
}

export interface ProxyCategory {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  is_hidden: boolean;
  proxy_count: number;
  default_price_usd: number | null;
  /**
   * Wave 22G — snapshot defaults prefilled into new proxies in this
   * category. NULL means "no default; admin must enter manually or
   * use Probe & autofill". Edits to these fields do NOT retroactively
   * change existing proxies (snapshot semantics — see mig 036).
   */
  default_country: string | null;
  default_proxy_type: ProxyType | null;
  default_isp: string | null;
  /**
   * Wave 22J → 22K — snapshot default for the proxy classification.
   * Free text (admin-extensible). See Proxy.network_type.
   */
  default_network_type: string | null;
  /** Wave 22K — snapshot default for vendor / source. */
  default_vendor_source?: string | null;
  /** Wave 22K — snapshot default for admin cost. */
  default_purchase_price_usd?: number | null;
  /** Wave 22K — snapshot default for sale price. */
  default_sale_price_usd?: number | null;
  min_stock_alert: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProxyCategoryInsert = Omit<
  ProxyCategory,
  "id" | "created_at" | "updated_at" | "proxy_count"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  proxy_count?: number;
};

export type ProxyCategoryUpdate = Partial<Omit<ProxyCategory, "id" | "created_at">> & {
  updated_at?: string;
};

export interface Proxy {
  id: string;
  host: string;
  port: number;
  type: "http" | "https" | "socks5";
  /** Wave 22A — FK to proxy_categories. Null when uncategorised. */
  category_id?: string | null;
  username: string | null;
  password: string | null;
  country: string | null;
  city: string | null;
  isp: string | null;
  status: "available" | "assigned" | "expired" | "banned" | "maintenance";
  speed_ms: number | null;
  last_checked_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  expires_at: string | null;
  /**
   * Wave 22J → 22K — proxy classification. FREE TEXT (admin-extensible).
   * Common suggested values: "ipv4", "ipv6", "isp", "residential",
   * "mobile", "bandwidth", "static_residential". Admin can type
   * custom labels per import (e.g., "proxy dung lượng").
   * Distinct from `type` (wire protocol) and `isp` (free-text vendor
   * name).
   */
  network_type?: string | null;
  /**
   * Wave 22K — sticker sale price (USD). Pair with cost_usd
   * (admin's purchase price) to compute margin per proxy.
   */
  sale_price_usd?: number | null;
  /**
   * Wave 22G — cascaded from proxy_categories.is_hidden. When true,
   * the proxy is filtered out of default /proxies queries and is not
   * eligible for distribution via /getproxy. Re-toggles automatically
   * on category reassignment via fn_proxy_inherit_hidden_on_reassign.
   */
  hidden?: boolean;
  notes: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  // ─── Wave 21A — manual inventory management ───
  /**
   * When admin paid for this proxy (distinct from created_at = DB insert).
   * Wave 22K relaxed NOT NULL — proxies imported without a known date
   * have null here.
   */
  purchase_date: string | null;
  /**
   * Free-text vendor name (e.g. "Proxy-Seller", "Self-built").
   * UI labels this as "Nguồn" (source).
   */
  vendor_label: string | null;
  /**
   * Per-proxy cost paid. UI labels this as "Giá mua".
   */
  cost_usd: number | null;
  /** FK to purchase_lots — groups proxies bought together. */
  purchase_lot_id: string | null;
  /** ISO 3166-1 alpha-2 from GeoIP at import time (vs `country` = vendor label). */
  geo_country_iso: string | null;
  /** How many times this proxy has been distributed (fair-rotation tie-breaker). */
  distribute_count: number;
  /** Last distribution time (fair-rotation tie-breaker). */
  last_distributed_at: string | null;
}

/**
 * One purchase batch — typically one CSV upload from a vendor portal.
 * Aggregates cost for spend-by-vendor reporting and groups proxies for
 * bulk-renew operations.
 */
export interface PurchaseLot {
  id: string;
  vendor_label: string;
  purchase_date: string;
  expiry_date: string | null;
  total_cost_usd: number | null;
  currency: string;
  source_file_name: string | null;
  batch_reference: string | null;
  notes: string | null;
  proxy_count: number;
  parent_lot_id: string | null;
  last_alert_24h_at: string | null;
  last_alert_7d_at: string | null;
  last_alert_30d_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProxyRequest {
  id: string;
  tele_user_id: string;
  proxy_id: string | null;
  proxy_type: "http" | "https" | "socks5" | null;
  country: string | null;
  status: "pending" | "approved" | "rejected" | "auto_approved" | "expired" | "cancelled";
  approval_mode: "auto" | "manual" | null;
  approved_by: string | null;
  rejected_reason: string | null;
  requested_at: string;
  processed_at: string | null;
  expires_at: string | null;
  quantity: number;
  batch_id: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  tele_user_id: string;
  telegram_message_id: number | null;
  direction: "incoming" | "outgoing";
  message_text: string | null;
  message_type: "text" | "command" | "callback" | "photo" | "document" | "system";
  raw_data: Record<string, unknown> | null;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  actor_type: "admin" | "tele_user" | "system" | "bot";
  actor_id: string | null;
  /**
   * Wave 22D point-in-time snapshot of the actor's display name.
   * Captured at insert time by lib/logger.ts; backfilled for old
   * rows by mig 034. Optional because:
   *   - Pre-Wave-22D rows might have NULL if backfill couldn't find
   *     a matching admin/tele_user (orphaned actor_id).
   *   - Selective fetches may not project the column.
   * UI fallback: when null, /logs shows the truncated UUID.
   */
  actor_display_name?: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface Setting {
  id: string;
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

// ----------------------
// Insert types (omit auto-generated fields)
// ----------------------

export type AdminInsert = Omit<Admin, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type AdminUpdate = Partial<Omit<Admin, "id" | "created_at">> & {
  updated_at?: string;
};

export type TeleUserInsert = Omit<TeleUser, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type TeleUserUpdate = Partial<Omit<TeleUser, "id" | "created_at">> & {
  updated_at?: string;
};

export type ProxyInsert = Omit<
  Proxy,
  "id" | "created_at" | "updated_at" | "purchase_date" | "distribute_count"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  // DB has NOT NULL — but defaults to now() in app code, so optional at TS layer.
  purchase_date?: string;
  // DB has DEFAULT 0 — optional at TS layer.
  distribute_count?: number;
};

export type ProxyUpdate = Partial<Omit<Proxy, "id" | "created_at">> & {
  updated_at?: string;
};

// ─── Wave 21A — purchase_lots Insert/Update ───
export type PurchaseLotInsert = Omit<
  PurchaseLot,
  "id" | "created_at" | "updated_at" | "proxy_count"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  proxy_count?: number;
  currency?: string;
};

export type PurchaseLotUpdate = Partial<Omit<PurchaseLot, "id" | "created_at">> & {
  updated_at?: string;
};

export type ProxyRequestInsert = Omit<ProxyRequest, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type ProxyRequestUpdate = Partial<Omit<ProxyRequest, "id" | "created_at">>;

export type ChatMessageInsert = Omit<ChatMessage, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type ActivityLogInsert = Omit<ActivityLog, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type SettingInsert = Omit<Setting, "id" | "updated_at"> & {
  id?: string;
  updated_at?: string;
};

export type SettingUpdate = Partial<Omit<Setting, "id">> & {
  updated_at?: string;
};

// ----------------------
// Database type for Supabase client
// ----------------------

export interface Database {
  public: {
    Tables: {
      admins: {
        Row: Admin;
        Insert: AdminInsert;
        Update: AdminUpdate;
        Relationships: [];
      };
      tele_users: {
        Row: TeleUser;
        Insert: TeleUserInsert;
        Update: TeleUserUpdate;
        Relationships: [];
      };
      proxies: {
        Row: Proxy;
        Insert: ProxyInsert;
        Update: ProxyUpdate;
        Relationships: [
          {
            foreignKeyName: "proxies_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "tele_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proxies_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "admins";
            referencedColumns: ["id"];
          },
        ];
      };
      proxy_requests: {
        Row: ProxyRequest;
        Insert: ProxyRequestInsert;
        Update: ProxyRequestUpdate;
        Relationships: [
          {
            foreignKeyName: "proxy_requests_tele_user_id_fkey";
            columns: ["tele_user_id"];
            isOneToOne: false;
            referencedRelation: "tele_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proxy_requests_proxy_id_fkey";
            columns: ["proxy_id"];
            isOneToOne: false;
            referencedRelation: "proxies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proxy_requests_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "admins";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: ChatMessage;
        Insert: ChatMessageInsert;
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "chat_messages_tele_user_id_fkey";
            columns: ["tele_user_id"];
            isOneToOne: false;
            referencedRelation: "tele_users";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_logs: {
        Row: ActivityLog;
        Insert: ActivityLogInsert;
        Update: Record<string, never>;
        Relationships: [];
      };
      settings: {
        Row: Setting;
        Insert: SettingInsert;
        Update: SettingUpdate;
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "admins";
            referencedColumns: ["id"];
          },
        ];
      };
      // ─── Wave 21A inventory tables ───
      purchase_lots: {
        Row: PurchaseLot;
        Insert: PurchaseLotInsert;
        Update: PurchaseLotUpdate;
        Relationships: [
          {
            foreignKeyName: "purchase_lots_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "admins";
            referencedColumns: ["id"];
          },
        ];
      };
      // ─── Wave 22A categories ───
      proxy_categories: {
        Row: ProxyCategory;
        Insert: ProxyCategoryInsert;
        Update: ProxyCategoryUpdate;
        Relationships: [
          {
            foreignKeyName: "proxy_categories_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "admins";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      // Wave 21C — feeds the dashboard cost-by-vendor card.
      dashboard_cost_by_vendor: {
        Row: {
          vendor_label: string;
          month: string;
          lot_count: number;
          proxy_total: number;
          spend_usd: number | null;
        };
      };
      // Wave 21C — feeds the lot-expiry-alert cron.
      expiring_soon_lots: {
        Row: PurchaseLot & {
          alert_window: "24h" | "7d" | "30d" | null;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: {
      admin_role: "super_admin" | "admin" | "viewer";
      proxy_type: "http" | "https" | "socks5";
      proxy_status: "available" | "assigned" | "expired" | "banned" | "maintenance";
      tele_user_status: "active" | "blocked" | "pending" | "banned";
      approval_mode: "auto" | "manual";
      request_status: "pending" | "approved" | "rejected" | "auto_approved" | "expired" | "cancelled";
      message_direction: "incoming" | "outgoing";
      message_type: "text" | "command" | "callback" | "photo" | "document" | "system";
      actor_type: "admin" | "tele_user" | "system" | "bot";
    };
    CompositeTypes: Record<string, never>;
  };
}
