"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type PostgresChangeEvent = "INSERT" | "UPDATE" | "DELETE";

interface UseRealtimeOptions<T> {
  table: string;
  schema?: string;
  event?: PostgresChangeEvent | "*";
  filter?: string;
  enabled?: boolean;
  onInsert?: (payload: T) => void;
  onUpdate?: (payload: T) => void;
  onDelete?: (payload: T) => void;
}

interface UseRealtimeReturn<T extends Record<string, unknown>> {
  data: RealtimePostgresChangesPayload<T> | null;
  isSubscribed: boolean;
  error: string | null;
}

export function useRealtime<T extends Record<string, unknown>>(
  options: UseRealtimeOptions<T>
): UseRealtimeReturn<T> {
  const {
    table,
    schema = "public",
    event = "*",
    filter,
    enabled = true,
    onInsert,
    onUpdate,
    onDelete,
  } = options;

  const [data, setData] = useState<RealtimePostgresChangesPayload<T> | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const handleChange = useCallback(
    (payload: RealtimePostgresChangesPayload<T>) => {
      setData(payload);
      if (payload.eventType === "INSERT" && onInsert) {
        onInsert(payload.new as T);
      } else if (payload.eventType === "UPDATE" && onUpdate) {
        onUpdate(payload.new as T);
      } else if (payload.eventType === "DELETE" && onDelete) {
        onDelete(payload.old as T);
      }
    },
    [onInsert, onUpdate, onDelete]
  );

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const channelName = `realtime-${table}-${Date.now()}`;

    const channelConfig: Record<string, string> = {
      event,
      schema,
      table,
    };
    if (filter) {
      channelConfig.filter = filter;
    }

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes" as never,
        channelConfig,
        handleChange as never
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setIsSubscribed(true);
          setError(null);
        } else if (status === "CHANNEL_ERROR") {
          setError("Failed to subscribe to realtime changes");
          setIsSubscribed(false);
        }
      });

    channelRef.current = channel;

    return () => {
      setIsSubscribed(false);
      supabase.removeChannel(channel);
    };
  }, [table, schema, event, filter, enabled, handleChange]);

  return { data, isSubscribed, error };
}
