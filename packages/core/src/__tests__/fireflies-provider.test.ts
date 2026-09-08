import { describe, expect, it } from "vitest";
import { FirefliesProvider, normalizeFirefliesMeeting } from "../index.js";

describe("normalizeFirefliesMeeting", () => {
  it("maps transcript, summary, participants, and action-item hints", () => {
    const m = normalizeFirefliesMeeting({
      id: "ff_1",
      title: "Pipeline review",
      date: 1725451200000,
      duration: 1800,
      organizer_email: "am@example.com",
      meeting_attendees: [
        { email: "am@example.com", displayName: "Alex" },
        { email: "cust@example.com", displayName: "Customer" },
      ],
      sentences: [
        { index: 0, text: "Hello", speaker_name: "Alex" },
        { index: 1, text: "We will renew next quarter", speaker_name: "Customer" },
      ],
      summary: { overview: "Discussed renewal", action_items: ["Send proposal"] },
      transcript_url: "https://app.fireflies.ai/view/ff_1",
    });
    expect(m.provider).toBe("fireflies");
    expect(m.title).toBe("Pipeline review");
    expect(m.participants).toHaveLength(2);
    expect(m.transcript).toHaveLength(2);
    expect(m.summary).toBe("Discussed renewal");
    expect(m.actionItemHints).toEqual(["Send proposal"]);
    expect(m.meetingUrl).toBe("https://app.fireflies.ai/view/ff_1");
  });

  it("handles empty transcript and missing summary", () => {
    const m = normalizeFirefliesMeeting({ id: "ff_2", title: "Empty" });
    expect(m.transcript).toEqual([]);
    expect(m.summary).toBeNull();
    expect(m.actionItemHints).toEqual([]);
  });

  it("is read-only (no bot/attendance command methods)", () => {
    const p = new FirefliesProvider({ apiKey: "x" });
    const anyP = p as unknown as Record<string, unknown>;
    expect(anyP.addToLiveMeeting).toBeUndefined();
    expect(anyP.joinMeeting).toBeUndefined();
    expect(anyP.removeBot).toBeUndefined();
    expect(anyP.inviteBot).toBeUndefined();
  });
});