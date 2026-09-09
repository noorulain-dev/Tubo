/**
 * Pilot user feedback.
 *
 * Only real, verbatim messages belong here. Nothing is invented: while this
 * array is empty the feedback section renders its placeholder framing and no
 * quote cards. To publish a quote, paste the exact message text below.
 */
export interface PilotQuote {
  /** Exact message text, unedited. */
  quote: string;
  author: string;
  role?: string;
  /** Where the message came from, e.g. "Slack". */
  channel?: string;
  /** ISO date of the message, if known. */
  date?: string;
}

export const PILOT_QUOTES: PilotQuote[] = [
  {
    quote: "You really did something with this product here",
    author: "Luis Mussa",
    role: "Customer Success Manager",
    channel: "Slack",
    date: "2026-09-08",
  },
  {
    quote: "Tubo caught the little things I often miss after taking back to back client meetings and my brain is fried",
    author: "Luis Mussa",
    role: "Customer Success Manager",
    channel: "Slack",
    date: "2026-09-08",
  },
];
