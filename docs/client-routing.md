# Client-Side Routing

The web app uses **React Router v6** (`react-router-dom@^6`). Every major screen has a real, deep-linkable URL, and the single-page app (SPA) supports direct navigation, page refresh, and browser back/forward without a full reload.

## Router

- [`apps/web/src/main.tsx`](../apps/web/src/main.tsx) wraps `<App />` in `<BrowserRouter>`, enabling HTML5 History API URLs (clean paths, no `#`).
- [`apps/web/src/App.tsx`](../apps/web/src/App.tsx) declares the full route table via `<Routes>` / `<Route>` and renders nested screens through an authenticated `<AppLayout>` with an `<Outlet />`.

## Route map

| Path | Screen | Auth |
|------|--------|------|
| `/` | Marketing landing | Public |
| `/login` | [`LoginScreen`](../apps/web/src/screens/LoginScreen.tsx) | Public |
| `/signup` | [`LoginScreen`](../apps/web/src/screens/LoginScreen.tsx) | Public |
| `/verify-email` | public placeholder | Public |
| `/forgot-password` | public placeholder | Public |
| `/reset-password` | public placeholder | Public |
| `/case-study` | public placeholder | Public |
| `/ai-collaboration` | public placeholder | Public |
| `/next` | public placeholder | Public |
| `/app` | redirect → `/app/command-center` | — |
| `/app/command-center` | [`CommandCenterScreen`](../apps/web/src/screens/CommandCenterScreen.tsx) | Protected |
| `/app/accounts` | [`AccountsScreen`](../apps/web/src/screens/AccountsScreen.tsx) | Protected |
| `/app/accounts/:accountId` | [`AccountScreen`](../apps/web/src/screens/AccountScreen.tsx) | Protected |
| `/app/process` | [`ProcessScreen`](../apps/web/src/screens/ProcessScreen.tsx) | Protected |
| `/app/runs` | [`RunsScreen`](../apps/web/src/screens/RunsScreen.tsx) | Protected |
| `/app/runs/:runId` | `RunPage` → [`ReviewScreen`](../apps/web/src/screens/ReviewScreen.tsx) | Protected |
| `/app/evaluation` | [`EvaluationScreen`](../apps/web/src/screens/EvaluationScreen.tsx) | Protected |
| `/app/settings` | [`SettingsScreen`](../apps/web/src/screens/SettingsScreen.tsx) | Protected |
| `*` | 404 "Not found" | Public |

## Protected routes

All `/app/*` routes are nested under a single layout route whose element is `AppLayout` when a user is authenticated, or `<Navigate to="/login" replace />` otherwise. `AppLayout` further guards itself and, if no user is present, redirects to `/login?returnTo=<original path>`. After login, [`onAuthed`](../apps/web/src/App.tsx) reads `returnTo` and navigates back to the originally requested path (validated to start with `/` to avoid open redirects).

## Public routes

`/`, `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/case-study`, `/ai-collaboration`, `/next` render without authentication. Public placeholder pages use the shared [`PublicScreen`](../apps/web/src/screens/PublicScreen.tsx).

## Deep linking

- Accounts: `<Link to={`/app/accounts/${accountId}`}>` in [`CommandCenterScreen`](../apps/web/src/screens/CommandCenterScreen.tsx) and [`AccountsScreen`](../apps/web/src/screens/AccountsScreen.tsx), plus `useParams<{ accountId }>()` in `AccountPage`.
- Runs: [`RunsScreen`](../apps/web/src/screens/RunsScreen.tsx) links each run row to `/app/runs/${run.id}`; `RunPage` reads `:runId` via `useParams` and loads the run through `useRun`.
- `ProcessScreen`'s `onAnalyzed` callback navigates to the newly created run's `/app/runs/:runId`.

Entity identifiers in URLs are exactly the backing `accountId` / `runId`, so a deep link survives a refresh and is shareable.

## Browser back/forward

`BrowserRouter` integrates with the History API, so the browser back/forward buttons work across both public and protected routes. Sidebar navigation uses `NavLink`, which keeps history entries consistent and derives the active state directly from the current route (`className={({ isActive }) => …}`).

## SPA production fallback

Because all paths are History-API routes, the web server must rewrite unknown paths to `index.html` so a direct load (or refresh) of `/app/runs/:runId` resolves to the SPA entry point rather than a 404.

- **Dev** (`npm run dev` → Vite) and **Preview** (`npm run preview` → `vite preview`) both enable SPA fallback (`appType: 'spa'`) by default — no extra configuration required.
- **Production** (e.g. Railway): serve the built `apps/web/dist` with the SPA start command `npm run preview --workspace @revexec/web` (Vite preview applies history fallback), or configure the host's static rewrite rule (`/*` → `/index.html`).

The `build` script remains `tsc --noEmit && vite build`, producing the static bundle in `apps/web/dist`.