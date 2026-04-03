import { describe, it, expect } from "vitest";

// We need to check messages.ts doesn't contain emojis
import * as fs from "fs";
import * as path from "path";

describe("telegram messages", () => {
  const messagesPath = path.join(__dirname, "..", "messages.ts");
  const content = fs.readFileSync(messagesPath, "utf-8");

  it("should not contain emoji unicode escapes", () => {
    const emojiPattern = /\\u\{1F[0-9A-F]{2,3}\}/g;
    const matches = content.match(emojiPattern);
    expect(matches).toBeNull();
  });

  it("should not contain emoji characters", () => {
    // Common emoji ranges
    const emojiChars = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const matches = content.match(emojiChars);
    expect(matches).toBeNull();
  });

  it("should contain Vietnamese diacritics in vi messages", () => {
    // Check for common Vietnamese characters
    expect(content).toContain("\u1EA1");
  });
});
