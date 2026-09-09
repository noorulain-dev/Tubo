import { useLocation } from "react-router-dom";

/**
 * The account the operator is currently looking at, derived from the route.
 * Integration panels use this so they show account-relevant context only.
 */
export function useAccountContext(): string | null {
  const { pathname } = useLocation();
  const match = /^\/app\/accounts\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
