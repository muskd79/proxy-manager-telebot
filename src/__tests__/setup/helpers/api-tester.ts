import { NextRequest } from "next/server";

export function createMockRequest(
  options: {
    method?: string;
    url?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const {
    method = "GET",
    url = "http://localhost/api/test",
    body,
    headers = {},
  } = options;
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", ...headers },
  });
}
