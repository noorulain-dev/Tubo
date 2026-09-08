export interface GmailOAuthOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Scopes needed to read threads/messages and create drafts on the user's behalf. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

export interface GmailAuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}

/**
 * Build the Google OAuth 2.0 authorization URL. Opening this in the browser
 * prompts the user for consent ("read email" + "compose drafts") and redirects
 * back to `redirectUri` with an authorization code.
 */
export function buildGmailAuthorizationUrl(opts: GmailAuthorizeUrlOptions): string {
  const scopes = opts.scopes ?? GMAIL_SCOPES;
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GmailAuthCodeResult {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Exchange an OAuth authorization code for tokens. `access_type=offline` +
 * `prompt=consent` ensures a refresh token is returned so we can keep acting on
 * the user's behalf without repeating the consent prompt.
 */
export async function exchangeGmailAuthCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<GmailAuthCodeResult> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail authorization code exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) {
    throw new Error("Gmail authorization code exchange returned no access_token");
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export interface GmailAccessToken {
  accessToken: string;
  /** Seconds until expiry (Google returns ~3600). Defaults to 3600 if absent. */
  expiresIn: number;
}

/**
 * Exchange a Gmail OAuth refresh token for a short-lived access token (Google
 * OAuth 2.0 token endpoint). Returns the token plus its lifetime so callers can
 * cache and refresh without re-prompting the user.
 */
export async function exchangeGmailRefreshToken(opts: GmailOAuthOptions): Promise<GmailAccessToken> {
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

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Gmail token refresh returned no access_token");
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}