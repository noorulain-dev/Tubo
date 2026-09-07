export interface GmailOAuthOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Exchange a Gmail OAuth refresh token for a short-lived access token
 * (Google OAuth 2.0 token endpoint). The access token is used as the Bearer
 * token by GmailClient. Auto-refresh on expiry is a follow-up; this performs
 * the exchange once at startup.
 */
export async function exchangeGmailRefreshToken(opts: GmailOAuthOptions): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail token refresh failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Gmail token refresh returned no access_token");
  }
  return data.access_token;
}