import { vi } from "vitest";

export function createMockTelegramContext(
  options: {
    userId?: number;
    username?: string;
    firstName?: string;
    text?: string;
    callbackData?: string;
  } = {}
) {
  const {
    userId = 123456,
    username = "testuser",
    firstName = "Test",
    text = "/start",
    callbackData,
  } = options;

  const replies: string[] = [];
  const edits: string[] = [];
  const callbackAnswers: string[] = [];

  const ctx = {
    from: { id: userId, is_bot: false, first_name: firstName, username },
    chat: { id: userId, type: "private" },
    message: text
      ? {
          message_id: Date.now(),
          text,
          from: { id: userId, is_bot: false, first_name: firstName, username },
          chat: { id: userId, type: "private" },
          date: Date.now() / 1000,
        }
      : undefined,
    callbackQuery: callbackData
      ? {
          id: "cb1",
          data: callbackData,
          from: { id: userId, is_bot: false, first_name: firstName, username },
          message: {
            message_id: 1,
            chat: { id: userId, type: "private" },
          },
        }
      : undefined,
    match: callbackData || "",
    reply: vi.fn(async (text: string) => {
      replies.push(text);
      return { message_id: Date.now() };
    }),
    editMessageText: vi.fn(async (text: string) => {
      edits.push(text);
    }),
    answerCallbackQuery: vi.fn(async (text?: string) => {
      if (text) callbackAnswers.push(text);
    }),
    // Expose captured data for assertions
    _replies: replies,
    _edits: edits,
    _callbackAnswers: callbackAnswers,
  };

  return ctx as any;
}
