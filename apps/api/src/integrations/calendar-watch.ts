import { randomUUID } from "node:crypto";
import { getPool } from "../database/db.js";
import { getCalendarRefreshToken } from "./connections.js";
import { exchangeGmailRefreshToken } from "./gmail-oauth.js";

export interface WatchChannel {
  channelId: string;
  userId: string;
  resourceId: string | null;
  expiration: string | null;
}

/**
 * Register a Google Calendar push-notification channel so Google pings us when
 * the user's events change. `webhookUrl` must be a publicly-reachable HTTPS
 * address (e.g. an ngrok URL) pointing at the notifications endpoint.
 */
export async function registerWatch(userId: string, webhookUrl: string): Promise<WatchChannel> {
  const refreshToken = await getCalendarRefreshToken(userId);
  if (!refreshToken) throw new Error("Google Calendar is not connected");
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth client is not configured");

  const { accessToken } = await exchangeGmailRefreshToken({ clientId, clientSecret, refreshToken });
  const channelId = randomUUID();
  const token = randomUUID();

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events/watch", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ id: channelId, type: "web_hook", address: webhookUrl, token }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar watch failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { resourceId?: string; resourceUri?: string; expiration?: string };
  const expiration = data.expiration ? new Date(Number(data.expiration)).toISOString() : null;

  const pool = getPool();
  await pool.query(
    `INSERT INTO calendar_watch_channels (channel_id, user_id, resource_id, resource_uri, token, expiration)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (channel_id) DO UPDATE SET expiration = EXCLUDED.expiration`,
    [channelId, userId, data.resourceId ?? null, data.resourceUri ?? null, token, expiration],
  );

  return { channelId, userId, resourceId: data.resourceId ?? null, expiration };
}

export async function getChannelUser(channelId: string): Promise<string | null> {
  const pool = getPool();
  const res = await pool.query("SELECT user_id FROM calendar_watch_channels WHERE channel_id = $1", [channelId]);
  return (res.rows[0] as { user_id: string } | undefined)?.user_id ?? null;
}

export async function listExpiringChannels(withinMs: number): Promise<{ channelId: string; userId: string }[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT channel_id, user_id FROM calendar_watch_channels WHERE expiration < now() + ($1 * interval '1 millisecond')",
    [withinMs],
  );
  return (res.rows as { channel_id: string; user_id: string }[]).map((r) => ({ channelId: r.channel_id, userId: r.user_id }));
}
