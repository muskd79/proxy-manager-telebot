# Proxy Manager TeleBot

Web-based proxy management system with Telegram bot distribution for 50+ admins and 1000+ users.

## Features
- Manage 50,000+ proxies (HTTP/HTTPS/SOCKS5)
- Telegram bot with 11 commands for proxy distribution
- Real-time dashboard with analytics
- RBAC (Super Admin / Admin / Viewer)
- Rate limiting (hourly/daily/total per user)
- Auto health checks, expiry warnings, trash cleanup

## Quick Start

### Prerequisites
- Node.js 22+
- Supabase account (Pro recommended)
- Vercel account (Pro recommended)
- Telegram Bot Token from @BotFather

### Setup
1. Clone and install:
   ```bash
   git clone https://github.com/muskd79/proxy-manager-telebot.git
   cd proxy-manager-telebot
   npm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Fill in `.env.local` with your Supabase and Telegram credentials.

4. Run database migrations:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

6. Set Telegram webhook:
   ```bash
   curl -X POST "https://api.telegram.org/botYOUR_TOKEN/setWebhook?url=https://your-app.vercel.app/api/telegram/webhook&secret_token=YOUR_SECRET"
   ```

## Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm test` | Run tests |
| `npm run test:watch` | Watch mode tests |

## Tech Stack
- Next.js 16 + TypeScript
- Supabase (PostgreSQL + Auth + Realtime)
- Vercel (Hosting + Cron)
- Grammy (Telegram Bot)
- shadcn/ui + Tailwind CSS

## Deployment
Push to `master` branch -> GitHub Actions CI -> Vercel auto-deploy.

## License
Private
