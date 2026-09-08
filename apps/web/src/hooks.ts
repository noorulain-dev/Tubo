import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { AccountDetail, AccountRow, InteractionInput, ProposalView, RunView } from "./types";

export function useRuns() {
  const [runs, setRuns] = useState<RunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await api.listRuns());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { runs, loading, error, refresh };
}

export function useRun(runId: string | null) {
  const [run, setRun] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      setRun(await api.getRun(runId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { run, setRun, loading, error, refresh };
}

export function useRunMutations(runId: string, onUpdated: (run: RunView) => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const run = await api.getRun(runId);
    onUpdated(run);
  }, [runId, onUpdated]);

  const mutate = useCallback(
    async (fn: () => Promise<ProposalView | unknown>): Promise<boolean> => {
      setPending(true);
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
        return false;
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  const approve = (id: string) => mutate(() => api.approveProposal(id));
  const reject = (id: string) => mutate(() => api.rejectProposal(id));
  const edit = (id: string, payload: Record<string, unknown>) => mutate(() => api.editProposal(id, payload));
  const execute = (id: string) => mutate(() => api.executeProposal(id));

  return { approve, reject, edit, execute, pending, error };
}

function useFocusRefresh(refresh: () => void) {
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
}

export function useCommandCenter() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCommandCenter();
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load command center");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useFocusRefresh(refresh);

  return { rows, total, loading, error, refresh };
}

export function useAccountDetail(accountId: string | null) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getAccountDetail(accountId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load account");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useFocusRefresh(refresh);

  return { detail, loading, error, refresh };
}

export type { InteractionInput, ProposalView, RunView };
