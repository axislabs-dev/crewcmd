import { describe, it, expect } from "vitest";
import {
  validateCompletionSchema,
  verifyTaskCompletion,
  evaluateSupervisorRejection,
  classifyCompletionOutcome,
  type AgentCompletionReport,
} from "./agent-completion-verification";

describe("validateCompletionSchema", () => {
  it("accepts a valid report", () => {
    const report: AgentCompletionReport = {
      taskId: "009b3686-4f93-45cf-893f-01d0f8a30d0b",
      repo: "axislabs-dev/crewcmd",
      branch: "feat/agent-completion-reliability",
      commits: [
        { hash: "abc1234", message: "Add completion verification" },
      ],
      prUrl: "https://github.com/axislabs-dev/crewcmd/pull/42",
      prNumber: 42,
      validationRun: {
        ci: "pass",
        tests: "pass",
        lint: "pass",
        timestamp: new Date().toISOString(),
      },
      executionSuccess: true,
      executionErrors: [],
      notes: "Test completed",
    };

    const result = validateCompletionSchema(report);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing taskId", () => {
    const report: AgentCompletionReport = {
      taskId: "",
      repo: "axislabs-dev/crewcmd",
      branch: "feat/test",
      commits: [],
      prUrl: null,
      prNumber: null,
      validationRun: {
        ci: "skipped",
        tests: "skipped",
        lint: "skipped",
        timestamp: new Date().toISOString(),
      },
      executionSuccess: false,
      executionErrors: [],
      notes: "",
    };

    const result = validateCompletionSchema(report);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("taskId is required");
  });

  it("rejects missing repo", () => {
    const report: AgentCompletionReport = {
      taskId: "task-123",
      repo: "",
      branch: "feat/test",
      commits: [],
      prUrl: null,
      prNumber: null,
      validationRun: {
        ci: "skipped",
        tests: "skipped",
        lint: "skipped",
        timestamp: new Date().toISOString(),
      },
      executionSuccess: false,
      executionErrors: [],
      notes: "",
    };

    const result = validateCompletionSchema(report);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("repo is required");
  });

  it("rejects missing branch", () => {
    const report: AgentCompletionReport = {
      taskId: "task-123",
      repo: "axislabs-dev/crewcmd",
      branch: "",
      commits: [],
      prUrl: null,
      prNumber: null,
      validationRun: {
        ci: "skipped",
        tests: "skipped",
        lint: "skipped",
        timestamp: new Date().toISOString(),
      },
      executionSuccess: false,
      executionErrors: [],
      notes: "",
    };

    const result = validateCompletionSchema(report);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("branch is required");
  });

  it("warns about missing PR URL", () => {
    const report: AgentCompletionReport = {
      taskId: "task-123",
      repo: "axislabs-dev/crewcmd",
      branch: "feat/test",
      commits: [
        { hash: "abc1234", message: "Some change" },
      ],
      prUrl: null,
      prNumber: null,
      validationRun: {
        ci: "pass",
        tests: "pass",
        lint: "pass",
        timestamp: new Date().toISOString(),
      },
      executionSuccess: true,
      executionErrors: [],
      notes: "No PR yet",
    };

    const result = validateCompletionSchema(report);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(
      "No PR URL or PR number provided — code delivery may be incomplete"
    );
  });

  it("rejects invalid commit hash format", () => {
    const report: AgentCompletionReport = {
      taskId: "task-123",
      repo: "axislabs-dev/crewcmd",
      branch: "feat/test",
      commits: [
        { hash: "not-a-hash", message: "Bad commit" },
      ],
      prUrl: "https://github.com/axislabs-dev/crewcmd/pull/1",
      prNumber: 1,
      validationRun: {
        ci: "pass",
        tests: "pass",
        lint: "pass",
        timestamp: new Date().toISOString(),
      },
      executionSuccess: true,
      executionErrors: [],
      notes: "",
    };

    const result = validateCompletionSchema(report);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("invalid hash format");
  });
});

describe("evaluateSupervisorRejection", () => {
  it("does not reject valid results", () => {
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
    };

    const rejection = evaluateSupervisorRejection(validation, "review");
    expect(rejection.rejected).toBe(false);
  });

  it("rejects when prUrl is missing for code tasks", () => {
    const validation = {
      valid: false,
      errors: ['Role pack "developer" requires prUrl before task can move to review or done'],
      warnings: [],
    };

    const rejection = evaluateSupervisorRejection(validation, "review");
    expect(rejection.rejected).toBe(true);
    expect(rejection.retrySuggestion).toContain("Open a PR");
  });

  it("suggests retry for missing branch", () => {
    const validation = {
      valid: false,
      errors: ["branch is required"],
      warnings: [],
    };

    const rejection = evaluateSupervisorRejection(validation, "done");
    expect(rejection.rejected).toBe(true);
    expect(rejection.retrySuggestion).toContain("branch name");
  });
});

describe("classifyCompletionOutcome", () => {
  it("classifies both ok", () => {
    const result = classifyCompletionOutcome(true, {
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(result.outcome).toBe("execution_and_report_ok");
  });

  it("classifies execution ok but report bad", () => {
    const result = classifyCompletionOutcome(true, {
      valid: false,
      errors: ["prUrl missing"],
      warnings: [],
    });
    expect(result.outcome).toBe("execution_ok_report_bad");
  });

  it("classifies execution bad but report valid (stale report)", () => {
    const result = classifyCompletionOutcome(false, {
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(result.outcome).toBe("execution_bad_report_ok");
  });

  it("classifies both failed", () => {
    const result = classifyCompletionOutcome(false, {
      valid: false,
      errors: ["task not found"],
      warnings: [],
    });
    expect(result.outcome).toBe("both_failed");
  });
});
