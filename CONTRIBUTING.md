# Contributing to Proxy Manager TeleBot

## Project Structure

```
src/
  app/                    # Next.js App Router
    (auth)/               # Auth pages (login, etc.)
    (dashboard)/          # Dashboard pages (protected)
    api/                  # API routes
  components/             # React components
  hooks/                  # Custom React hooks
  lib/                    # Shared libraries
    supabase/             # Supabase client & admin
    telegram/             # Telegram bot
      bot.ts              # Bot instance
      handlers.ts         # Command & event registration
      keyboard.ts         # Inline keyboard builders
      messages.ts         # All bot message strings (vi/en)
      utils.ts            # Helpers: getOrCreateUser, logChat, revokeProxy
      commands/            # One file per command handler
        index.ts           # Re-exports all handlers
        start.ts           # /start
        get-proxy.ts       # /getproxy, proxy type callback
        my-proxies.ts      # /myproxies
        status.ts          # /status
        revoke.ts          # /revoke, revoke callback
        cancel.ts          # /cancel
        language.ts        # /language, language callback
        help.ts            # /help, unknown command
  locales/                # i18n translation files
  types/                  # TypeScript type definitions
  middleware.ts           # Next.js middleware (auth, redirects)
```

## How to Add a New Page

1. Create the page file at `src/app/(dashboard)/your-page/page.tsx`.
2. Add an API route at `src/app/api/your-resource/route.ts` if the page needs data.
3. Add components in `src/components/your-feature/`.
4. Add a sidebar link in `src/components/layout/sidebar.tsx`.

## How to Add a New Bot Command

1. Create a handler file at `src/lib/telegram/commands/your-command.ts`.
2. Add any new message strings in `src/lib/telegram/messages.ts`.
3. Export the handler from `src/lib/telegram/commands/index.ts`.
4. Register the command in `src/lib/telegram/handlers.ts` with `bot.command(...)`.

Each command file follows this pattern:

```typescript
import type { Context } from "grammy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { t } from "../messages";
import { getOrCreateUser, logChatMessage } from "../utils";
import { ChatDirection, MessageType } from "@/types/database";
import type { SupportedLanguage } from "@/types/telegram";

export async function handleYourCommand(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const lang = user.language as SupportedLanguage;

  await logChatMessage(
    user.id,
    ctx.message?.message_id ?? null,
    ChatDirection.Incoming,
    "/yourcommand",
    MessageType.Command
  );

  // ... your logic here

  const text = t("yourMessageKey", lang);
  await ctx.reply(text);
  await logChatMessage(user.id, null, ChatDirection.Outgoing, text, MessageType.Text);
}
```

## How to Add a New API Endpoint

1. Create a route file at `src/app/api/your-resource/route.ts`.
2. Use `requireRole()` for authentication and role checks.
3. Use `logActivity()` for audit logging on write operations.
4. Return responses in the standard format: `{ success: true, data }` or `{ success: false, error }`.

## Naming Conventions

- **Files**: kebab-case (`proxy-table.tsx`)
- **Components**: PascalCase (`ProxyTable`)
- **Hooks**: camelCase with `use` prefix (`useProxies`)
- **API routes**: lowercase plural nouns (`/api/proxies`)
- **Bot commands**: lowercase, no separators (`/getproxy`, `/myproxies`)

## Message Style

Bot messages use plain text indicators instead of emojis:

- `[OK]` for success
- `[X]` for errors
- `[i]` for informational messages
- `[!]` for warnings
- `[###-----]` style for progress bars

## PR Checklist

- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Build passes (`npm run build`)
- [ ] No `console.log` in production code
- [ ] API responses use `{ success, data/error }` format
- [ ] Role checks applied to new API routes
- [ ] Activity logging for write operations
- [ ] Bot messages added to `messages.ts` (not inline)
- [ ] New commands registered in `handlers.ts` and exported from `commands/index.ts`
