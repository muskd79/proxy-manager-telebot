// One-shot: push BOT_COMMANDS descriptions to Telegram via setMyCommands.
// Run: node scripts/push-bot-commands.mjs
// Reads TELEGRAM_BOT_TOKEN from .env.local.

import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf-8");
const token = env.match(/TELEGRAM_BOT_TOKEN=(.+)/)?.[1]?.trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN not found in .env.local");
  process.exit(1);
}

const commandsVi = [
  { command: "start", description: "Bắt đầu và đăng ký" },
  { command: "getproxy", description: "Yêu cầu proxy mới" },
  { command: "myproxies", description: "Xem proxy của bạn" },
  { command: "checkproxy", description: "Kiểm tra proxy" },
  { command: "status", description: "Trạng thái tài khoản" },
  { command: "history", description: "Lịch sử yêu cầu" },
  { command: "revoke", description: "Trả proxy" },
  { command: "cancel", description: "Hủy yêu cầu đang chờ" },
  { command: "support", description: "Hỗ trợ" },
  { command: "language", description: "Đổi ngôn ngữ" },
  { command: "help", description: "Hướng dẫn sử dụng" },
  { command: "requests", description: "Duyệt yêu cầu (Admin)" },
];

const commandsEn = [
  { command: "start", description: "Start and register" },
  { command: "getproxy", description: "Request a new proxy" },
  { command: "myproxies", description: "View your proxies" },
  { command: "checkproxy", description: "Check proxy health" },
  { command: "status", description: "Account status" },
  { command: "history", description: "Request history" },
  { command: "revoke", description: "Return proxy" },
  { command: "cancel", description: "Cancel pending requests" },
  { command: "support", description: "Contact support" },
  { command: "language", description: "Change language" },
  { command: "help", description: "Help" },
  { command: "requests", description: "Pending requests (Admin)" },
];

async function setMyCommands(commands, languageCode) {
  const body = JSON.stringify(
    languageCode ? { commands, language_code: languageCode } : { commands },
  );
  const res = await fetch(
    `https://api.telegram.org/bot${token}/setMyCommands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
    },
  );
  const json = await res.json();
  if (!json.ok) {
    console.error(`setMyCommands(${languageCode || "default"}) FAILED:`, json);
    process.exit(1);
  }
  console.log(`setMyCommands(${languageCode || "default"}) OK`);
}

await setMyCommands(commandsEn);
await setMyCommands(commandsVi, "vi");
console.log("All Telegram bot commands pushed.");
