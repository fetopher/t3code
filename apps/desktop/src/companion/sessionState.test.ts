// @effect-diagnostics nodeBuiltinImport:off -- Disposable SQLite fixtures, never the installed app's data.
import { describe, it, expect } from "vite-plus/test";
import * as NodeSqlite from "node:sqlite";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { readSessionStates, sessionTransitions, type SessionState } from "./sessionState.ts";

const state = (values: Partial<SessionState> = {}): SessionState => ({
  id: "thread",
  title: "Work",
  runId: "turn",
  attention: null,
  completion: null,
  ...values,
});

describe("companion attention transitions", () => {
  it("baselines existing requests and alerts once per new approval", () => {
    const approval = state({ attention: "Approval needed:request-1" });
    expect(sessionTransitions(new Map(), [approval], true)).toEqual([]);
    const previous = new Map([["thread", state()]]);
    expect(sessionTransitions(previous, [approval], true).map((event) => event.title)).toEqual([
      "Approval needed",
    ]);
    expect(sessionTransitions(new Map([["thread", approval]]), [approval], true)).toEqual([]);
    expect(
      sessionTransitions(
        new Map([["thread", approval]]),
        [state({ attention: "Approval needed:request-2" })],
        true,
      ),
    ).toHaveLength(1);
  });
  it("honors attention-only and detects a new turn needing input", () => {
    const previous = new Map([["thread", state({ attention: "Input needed" })]]);
    expect(
      sessionTransitions(previous, [state({ attention: "Input needed", runId: "next" })], true),
    ).toHaveLength(1);
    const completed = state({ completion: "2026-10-07T16:00:00Z" });
    expect(sessionTransitions(previous, [completed], true)).toEqual([]);
    expect(sessionTransitions(previous, [completed], false)[0]?.title).toBe("Thread completed");
  });
});

describe("standard T3 database monitoring", () => {
  it("reads legacy attention state without modifying the database", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-companion-v1-"));
    const path = NodePath.join(directory, "state.sqlite");
    try {
      const db = new NodeSqlite.DatabaseSync(path);
      db.exec(`CREATE TABLE projection_threads(thread_id,title,latest_turn_id,pending_approval_count,pending_user_input_count,has_actionable_proposed_plan,deleted_at,archived_at);
        CREATE TABLE projection_turns(thread_id,turn_id,state,completed_at);
        CREATE TABLE projection_thread_sessions(thread_id,last_error,status);
        CREATE TABLE projection_pending_approvals(thread_id,request_id,status);
        INSERT INTO projection_threads VALUES ('t','Review','r',1,0,0,NULL,NULL), ('archived','Old','r',1,0,0,NULL,'yesterday');
        INSERT INTO projection_turns VALUES ('t','r','running',NULL);
        INSERT INTO projection_pending_approvals VALUES ('t','a','pending');`);
      db.close();
      const before = NodeFS.readFileSync(path);
      expect(readSessionStates(directory)).toEqual([
        { id: "t", title: "Review", runId: "r", attention: "Approval needed:a", completion: null },
      ]);
      expect(NodeFS.readFileSync(path)).toEqual(before);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("follows the V2 database after an official migration", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-companion-v2-"));
    try {
      const db = new NodeSqlite.DatabaseSync(NodePath.join(directory, "statev2.sqlite"));
      db.exec(`CREATE TABLE orchestration_v2_projection_threads(thread_id,title,deleted_at,archived_at);
        CREATE TABLE orchestration_v2_projection_runs(thread_id,run_id,ordinal,status,completed_at);
        CREATE TABLE orchestration_v2_projection_runtime_requests(thread_id,runtime_request_id,status,kind);
        INSERT INTO orchestration_v2_projection_threads VALUES ('t','New protocol',NULL,NULL);
        INSERT INTO orchestration_v2_projection_runs VALUES ('t','older',1,'completed','earlier'),('t','latest',2,'waiting',NULL);
        INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('t','input-1','pending','user_input');`);
      db.close();
      expect(readSessionStates(directory)).toEqual([
        {
          id: "t",
          title: "New protocol",
          runId: "latest",
          attention: "Input needed",
          completion: null,
        },
      ]);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
