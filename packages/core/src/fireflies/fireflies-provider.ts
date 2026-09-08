import { AuthenticationError, ProviderError, RateLimitError } from "../errors.js";

/** A provider-independent normalized meeting-notes artifact. */
export interface MeetingArtifact {
  provider: string;
  providerMeetingId: string;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  organizer: string | null;
  participants: string[];
  calendarReference: string | null;
  meetingUrl: string | null;
  transcript: { speaker: string | null; text: string; ts: number | null }[];
  summary: string | null;
  actionItemHints: string[];
  providerCreatedAt: string | null;
  providerUpdatedAt: string | null;
  provenance: string;
}

export interface MeetingNotesProvider {
  validateConnection(): Promise<{ ok: boolean; message?: string }>;
  listRecentMeetings(): Promise<MeetingArtifact[]>;
  getTranscript(meetingId: string): Promise<MeetingArtifact["transcript"]>;
  getSummary(meetingId: string): Promise<string | null>;
}

interface FirefliesSentence {
  index?: number;
  text?: string;
  speaker_name?: string;
}

interface FirefliesTranscript {
  id: string;
  title?: string;
  date?: number;
  duration?: number;
  organizer_email?: string;
  participants?: string[];
  meeting_attendees?: { displayName?: string; email?: string }[];
  sentences?: FirefliesSentence[];
  summary?: { overview?: string; action_items?: string[] };
  transcript_url?: string;
}

export function normalizeFirefliesMeeting(raw: FirefliesTranscript): MeetingArtifact {
  const participants = raw.participants ?? [];
  const sentences = (raw.sentences ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((s) => ({ speaker: s.speaker_name ?? null, text: s.text ?? "", ts: s.index ?? null }));
  const startedAt = raw.date ? new Date(raw.date).toISOString() : null;
  const endedAt = raw.date && raw.duration != null ? new Date(raw.date + raw.duration * 1000).toISOString() : null;
  return {
    provider: "fireflies",
    providerMeetingId: raw.id,
    title: raw.title ?? null,
    startedAt,
    endedAt,
    organizer: raw.organizer_email ?? null,
    participants,
    calendarReference: null,
    meetingUrl: raw.transcript_url ?? null,
    transcript: sentences,
    summary: raw.summary?.overview ?? null,
    actionItemHints: raw.summary?.action_items ?? [],
    providerCreatedAt: startedAt,
    providerUpdatedAt: null,
    provenance: "fireflies",
  };
}

export interface FirefliesProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Read-only Fireflies provider. It only lists/reads transcripts the user's own
 * Fireflies account already produced. It can NEVER command Fireflies to join a
 * meeting, record, or take any attendance action.
 */
export class FirefliesProvider implements MeetingNotesProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FirefliesProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.fireflies.ai/graphql").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async validateConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.query<{ transcripts?: FirefliesTranscript[] }>(`query { transcripts { id } }`);
      return { ok: Array.isArray(res.transcripts) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listRecentMeetings(): Promise<MeetingArtifact[]> {
    const res = await this.query<{ transcripts?: FirefliesTranscript[] }>(`
      query {
        transcripts {
          id title date duration organizer_email
          transcript_url
          sentences { index text speaker_name }
          summary { overview action_items }
        }
      }
    `);
    return (res.transcripts ?? []).map(normalizeFirefliesMeeting);
  }

  async getTranscript(meetingId: string): Promise<MeetingArtifact["transcript"]> {
    const res = await this.query<{ transcript?: FirefliesTranscript }>(
      `query { transcript(id: "${meetingId}") { id sentences { index text speaker_name } } }`,
    );
    if (!res.transcript) throw new ProviderError("Fireflies meeting not found", { status: 404, details: { notFound: true } });
    return normalizeFirefliesMeeting(res.transcript).transcript;
  }

  async getSummary(meetingId: string): Promise<string | null> {
    const res = await this.query<{ transcript?: FirefliesTranscript }>(
      `query { transcript(id: "${meetingId}") { id summary { overview } } }`,
    );
    if (!res.transcript) throw new ProviderError("Fireflies meeting not found", { status: 404, details: { notFound: true } });
    return res.transcript.summary?.overview ?? null;
  }

  private async query<T>(gql: string): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query: gql }),
    });
    if (!res.ok) {
      if (res.status === 401) throw new AuthenticationError(`Fireflies authentication failed (401)`);
      if (res.status === 429) throw new RateLimitError(`Fireflies rate limited (429)`);
      throw new ProviderError(`Fireflies request failed (${res.status})`, { retryable: res.status >= 500 });
    }
    const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (body.errors?.length) {
      throw new ProviderError(`Fireflies GraphQL error: ${body.errors[0]?.message ?? "unknown"}`);
    }
    return body.data ?? ({} as T);
  }
}
