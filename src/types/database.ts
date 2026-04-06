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
}

export interface Proxy {
  id: string;
  host: string;
  port: number;
  type: "http" | "https" | "socks5";
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
  tags: string[] | null;
  notes: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
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

export type ProxyInsert = Omit<Proxy, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ProxyUpdate = Partial<Omit<Proxy, "id" | "created_at">> & {
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
    };
    Views: Record<string, never>;
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
