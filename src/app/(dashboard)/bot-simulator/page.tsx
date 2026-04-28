/**
 * Wave 22U — /bot-simulator moved into /bot/simulator under the new
 * "Quản lý Bot" parent route. This file is a server-side redirect
 * for backward-compat: bookmarks, internal links, and the
 * historical sidebar URL all continue to work.
 *
 * Architect's call (over rewrites in next.config): page-level
 * `redirect()` is declarative, easy to grep, and keeps the route
 * inside the (dashboard) auth boundary so unauthenticated visitors
 * still hit the login flow before the redirect resolves.
 */
import { redirect } from "next/navigation";

export default function BotSimulatorRedirect() {
  redirect("/bot/simulator");
}
