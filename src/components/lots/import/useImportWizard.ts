"use client";

import { useReducer, useCallback } from "react";
import { uuidv7 } from "@/lib/uuid7";
import type { ProxyImportRow } from "@/lib/lots/import-payload";
import { parseProxyCsv, type ParsedProxyRow } from "@/lib/csv";
import { countryFromIp } from "@/lib/geoip/country-from-ip";

/**
 * State machine for the 3-step lot-import wizard.
 *
 * paste -> parsed -> metadata -> submitting -> done | error
 *
 * The hook exposes a tiny reducer-driven API:
 *   - setPasteText(): user types/pastes CSV
 *   - parsePaste(): converts to rows, validates, transitions to "parsed"
 *   - setMetadata(): user fills lot fields
 *   - submit(): POSTs to /api/lots, transitions to "submitting" then "done"
 *   - reset(): back to "paste" with a fresh idempotency_key
 */

export type WizardStep = "paste" | "parsed" | "metadata" | "submitting" | "done" | "error";

export interface LotMetadataForm {
  vendor_label: string;
  purchase_date: string; // ISO date (yyyy-mm-dd)
  expiry_date: string;   // ISO date
  total_cost_usd: string;
  currency: string;
  batch_reference: string;
  notes: string;
  source_file_name: string;
}

export interface WizardState {
  step: WizardStep;
  pasteText: string;
  parsedRows: ParsedProxyRow[];
  metadata: LotMetadataForm;
  /** UUIDv7 generated once per wizard session — guarantees retry idempotency. */
  idempotencyKey: string;
  errorMessage: string | null;
  result: {
    lot_id: string;
    inserted: number;
    updated: number;
    deduplicated: boolean;
  } | null;
}

type Action =
  | { type: "SET_PASTE"; text: string }
  | { type: "PARSE" }
  | { type: "SET_METADATA"; partial: Partial<LotMetadataForm> }
  | { type: "GO_TO_METADATA" }
  | { type: "BACK_TO_PARSED" }
  // Wave 22E-2 BUG FIX (B8): added BACK_TO_PASTE so the "Back to paste"
  // button in step 2 can actually navigate back. Pre-fix code called
  // setPasteText(state.pasteText) — a no-op self-set with no step change.
  | { type: "BACK_TO_PASTE" }
  | { type: "SUBMITTING" }
  | { type: "DONE"; result: WizardState["result"] }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

function defaultMetadata(): LotMetadataForm {
  const today = new Date().toISOString().slice(0, 10);
  return {
    vendor_label: "",
    purchase_date: today,
    expiry_date: "",
    total_cost_usd: "",
    currency: "USD",
    batch_reference: "",
    notes: "",
    source_file_name: "",
  };
}

function initialState(): WizardState {
  return {
    step: "paste",
    pasteText: "",
    parsedRows: [],
    metadata: defaultMetadata(),
    idempotencyKey: uuidv7(),
    errorMessage: null,
    result: null,
  };
}

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "SET_PASTE":
      return { ...state, pasteText: action.text };
    case "PARSE": {
      const rows = parseProxyCsv(state.pasteText);
      return { ...state, parsedRows: rows, step: "parsed" };
    }
    case "SET_METADATA":
      return { ...state, metadata: { ...state.metadata, ...action.partial } };
    case "GO_TO_METADATA":
      return { ...state, step: "metadata" };
    case "BACK_TO_PARSED":
      return { ...state, step: "parsed" };
    case "BACK_TO_PASTE":
      // Keep pasteText so the user doesn't lose their input; only flip step.
      return { ...state, step: "paste" };
    case "SUBMITTING":
      return { ...state, step: "submitting", errorMessage: null };
    case "DONE":
      return { ...state, step: "done", result: action.result };
    case "ERROR":
      return { ...state, step: "error", errorMessage: action.message };
    case "RESET":
      return initialState();
  }
}

export function useImportWizard() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  const setPasteText = useCallback((text: string) => {
    dispatch({ type: "SET_PASTE", text });
  }, []);

  const parsePaste = useCallback(() => {
    dispatch({ type: "PARSE" });
  }, []);

  const goToMetadata = useCallback(() => {
    dispatch({ type: "GO_TO_METADATA" });
  }, []);

  const backToParsed = useCallback(() => {
    dispatch({ type: "BACK_TO_PARSED" });
  }, []);

  const backToPaste = useCallback(() => {
    dispatch({ type: "BACK_TO_PASTE" });
  }, []);

  const setMetadata = useCallback((partial: Partial<LotMetadataForm>) => {
    dispatch({ type: "SET_METADATA", partial });
  }, []);

  const submit = useCallback(async () => {
    dispatch({ type: "SUBMITTING" });
    try {
      const validRows = state.parsedRows.filter((r) => !r.error);
      if (validRows.length === 0) {
        dispatch({ type: "ERROR", message: "No valid rows to import." });
        return;
      }

      const proxies: ProxyImportRow[] = validRows.map((r) => {
        // Wave 22E-2 BUG FIX (B7): vendor-supplied country wins over our
        // GeoIP heuristic. Pre-fix code unconditionally called
        // countryFromIp(host) and silently discarded any country parsed
        // from the CSV. Now: prefer r.country (5th CSV column);
        // fall back to GeoIP only when vendor didn't supply one.
        const country = r.country ?? countryFromIp(r.host);
        return {
          host: r.host,
          port: r.port,
          type: "http",
          username: r.username ?? null,
          password: r.password ?? null,
          country,
          isp: null,
          tags: null,
          notes: null,
          expires_at: null,
        };
      });

      const m = state.metadata;
      const lot = {
        vendor_label: m.vendor_label.trim(),
        purchase_date: m.purchase_date
          ? new Date(m.purchase_date).toISOString()
          : new Date().toISOString(),
        expiry_date: m.expiry_date ? new Date(m.expiry_date).toISOString() : null,
        total_cost_usd: m.total_cost_usd ? Number(m.total_cost_usd) : null,
        currency: m.currency || "USD",
        batch_reference: m.batch_reference || null,
        notes: m.notes || null,
        source_file_name: m.source_file_name || null,
      };

      const res = await fetch("/api/lots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_key: state.idempotencyKey,
          lot,
          proxies,
        }),
      });
      const body = await res.json();

      if (!body.success) {
        dispatch({
          type: "ERROR",
          message: body.error ?? `Import failed (HTTP ${res.status})`,
        });
        return;
      }

      dispatch({
        type: "DONE",
        result: {
          lot_id: body.data.lot_id,
          inserted: body.data.inserted_proxies,
          updated: body.data.updated_proxies,
          deduplicated: body.data.deduplicated,
        },
      });
    } catch (err) {
      dispatch({
        type: "ERROR",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [state.idempotencyKey, state.metadata, state.parsedRows]);

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return {
    state,
    setPasteText,
    parsePaste,
    goToMetadata,
    backToParsed,
    backToPaste,
    setMetadata,
    submit,
    reset,
  };
}
