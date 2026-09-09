# Google OAuth — Assessment Limitation

## Status

The Google OAuth app used by Revenue Execution OS is currently in **Testing** mode.

## What this means

- Only Google accounts explicitly added as **OAuth test users** can authorize the Gmail and Google Calendar scopes.
- An external recruiter/evaluator connecting their own personal Google account will not be able to complete the OAuth consent flow until their address is allowlisted.
- This is a **development/assessment limitation**, not a product defect.

## Why it is not a blocker for review

The evaluator experience does **not** depend on granting access to personal Google data:

- A dedicated **evaluator workspace** is preconfigured with synthetic `[ASSESSMENT]`-tagged test records.
- The complete workflow — Command Center → Accounts → findings → investigations → proposals → execution plans → manual Process Interaction — can be reviewed without any Google authorization.
- **Process Interaction** (semantic interpretation, account reasoning, gap detection, investigation, proposal, approval UX) works with no OAuth connection.
- **External execution is disabled** in the evaluator workspace, so no personal HubSpot/Gmail data can ever be mutated.

## Path to public Google connection

Enabling OAuth for arbitrary Google accounts requires:

1. Moving the OAuth app out of Testing to **In production** in the Google Cloud Console.
2. Depending on the requested scopes (e.g. Gmail read/modify, Calendar read), completing Google's **sensitive/restricted scope verification**.
3. Publishing a privacy policy and terms of service, and (for restricted scopes) passing Google's security assessment.

None of this affects the current assessment review.

## Security invariants preserved

- No OAuth bypass: authorization always flows through Google's standard consent + token exchange.
- No fake connections: an unconnected integration yields an **empty** provider, never fabricated data.
- No credential sharing: the operator's personal credentials are never used as evaluator credentials and are never surfaced to the evaluator.
- Tenancy intact: integrations and records remain strictly per-user (`user_id`), so the evaluator can only ever see their own synthetic tenant.