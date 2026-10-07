// @effect-diagnostics nodeBuiltinImport:off -- This adapter only reads the standard app's SQLite projections.
import * as NodeSqlite from "node:sqlite";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface SessionState {
  id: string;
  title: string;
  runId: string;
  attention: string | null;
  completion: string | null;
}

/** Never creates, migrates, or writes the standard app's database. */
export function readSessionStates(stateDir: string): SessionState[] {
  const v2 = NodePath.join(stateDir, "statev2.sqlite");
  const database = NodeFS.existsSync(v2) ? v2 : NodePath.join(stateDir, "state.sqlite");
  if (!NodeFS.existsSync(database)) return [];
  const db = new NodeSqlite.DatabaseSync(database, { readOnly: true, timeout: 250 });
  try {
    const isV2 = db
      .prepare("SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_projection_threads'")
      .get();
    const records = isV2
      ? db
          .prepare(`SELECT t.thread_id AS id, t.title, r.run_id AS runId,
          r.status AS status, r.completed_at AS completedAt,
          (SELECT group_concat(q.runtime_request_id) FROM orchestration_v2_projection_runtime_requests q
            WHERE q.thread_id=t.thread_id AND q.status='pending' AND q.kind='approval') AS approvals,
          (SELECT group_concat(q.runtime_request_id) FROM orchestration_v2_projection_runtime_requests q
            WHERE q.thread_id=t.thread_id AND q.status='pending' AND q.kind='user_input') AS inputs,
          0 AS plan, NULL AS error, NULL AS sessionStatus
          FROM orchestration_v2_projection_threads t
          LEFT JOIN orchestration_v2_projection_runs r ON r.run_id=(SELECT run_id FROM orchestration_v2_projection_runs
            WHERE thread_id=t.thread_id ORDER BY ordinal DESC LIMIT 1)
          WHERE t.deleted_at IS NULL AND t.archived_at IS NULL`)
          .all()
      : db
          .prepare(`SELECT t.thread_id AS id, t.title, t.latest_turn_id AS runId,
          r.state AS status, r.completed_at AS completedAt,
          CASE WHEN t.pending_approval_count > 0 THEN COALESCE((SELECT group_concat(a.request_id)
            FROM projection_pending_approvals a WHERE a.thread_id=t.thread_id AND a.status='pending'), 'pending') END AS approvals,
          CASE WHEN t.pending_user_input_count > 0 THEN 'pending' END AS inputs,
          t.has_actionable_proposed_plan AS plan, s.last_error AS error, s.status AS sessionStatus
          FROM projection_threads t LEFT JOIN projection_turns r ON r.turn_id=t.latest_turn_id AND r.thread_id=t.thread_id
          LEFT JOIN projection_thread_sessions s ON s.thread_id=t.thread_id
          WHERE t.deleted_at IS NULL AND t.archived_at IS NULL`)
          .all();
    return records.map((row) => {
      const attention = row.approvals
        ? `Approval needed:${row.approvals}`
        : row.inputs || row.plan
          ? "Input needed"
          : row.error &&
              /rate.?limit|quota|usage limit/i.test(String(row.error)) &&
              (row.status === "failed" || row.status === "error" || row.sessionStatus === "error")
            ? "Usage limit reached"
            : row.status === "failed" || row.status === "error" || row.sessionStatus === "error"
              ? "Thread failed"
              : null;
      return {
        id: String(row.id),
        title: String(row.title),
        runId: String(row.runId ?? ""),
        attention,
        completion: row.status === "completed" && row.completedAt ? String(row.completedAt) : null,
      };
    });
  } finally {
    db.close();
  }
}

/** Baseline on startup/reconnect; notify only new transitions, never old requests. */
export function sessionTransitions(
  previous: ReadonlyMap<string, SessionState>,
  next: readonly SessionState[],
  attentionOnly: boolean,
  includeNew = false,
) {
  return next.flatMap((session) => {
    const prior = previous.get(session.id);
    if (!prior)
      return includeNew && session.attention
        ? [{ session, title: session.attention.split(":")[0]! }]
        : [];
    if (
      session.attention &&
      (session.attention !== prior.attention || session.runId !== prior.runId)
    )
      return [{ session, title: session.attention.split(":")[0]! }];
    if (!attentionOnly && session.completion && session.completion !== prior.completion)
      return [{ session, title: "Thread completed" }];
    return [];
  });
}
