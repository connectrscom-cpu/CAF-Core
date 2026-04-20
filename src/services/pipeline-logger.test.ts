import { afterEach, describe, expect, it } from "vitest";
import {
  buildPipelineLogEvent,
  logPipelineEvent,
  setPipelineLogSink,
} from "./pipeline-logger.js";

describe("buildPipelineLogEvent", () => {
  it("produces a stable shape with ts + level + stage + message", () => {
    const e = buildPipelineLogEvent("info", "qc", "passed", {
      job_id: "job_1",
      task_id: "t_1",
      run_id: "r_1",
      flow_type: "FLOW_CAROUSEL_SNS5",
    });
    expect(e.level).toBe("info");
    expect(e.stage).toBe("qc");
    expect(e.message).toBe("passed");
    expect(e.job_id).toBe("job_1");
    expect(e.flow_type).toBe("FLOW_CAROUSEL_SNS5");
    expect(() => new Date(e.ts).toISOString()).not.toThrow();
  });

  it("tolerates empty context", () => {
    const e = buildPipelineLogEvent("warn", "render", "slow");
    expect(e.message).toBe("slow");
    expect(e.job_id).toBeUndefined();
  });
});

describe("logPipelineEvent", () => {
  let captured: string[] = [];
  const install = () => {
    captured = [];
    return setPipelineLogSink((line) => {
      captured.push(line);
    });
  };

  afterEach(() => {
    // Reset to default stderr sink so other tests don't see our capture.
    setPipelineLogSink((line) => {
      process.stderr.write(line);
    });
  });

  it("writes a single JSON line terminated with \\n", () => {
    install();
    logPipelineEvent("info", "generate", "ok", { job_id: "j1" });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(captured[0]!.trim());
    expect(parsed.stage).toBe("generate");
    expect(parsed.job_id).toBe("j1");
  });

  it("never throws, even with circular data", () => {
    install();
    const bad: Record<string, unknown> = {};
    bad.self = bad;
    expect(() =>
      logPipelineEvent("error", "other", "oops", { data: bad })
    ).not.toThrow();
    // When JSON.stringify fails the sink still should not receive a bad line;
    // we accept 0 or 1 captured lines as long as no throw.
    expect(captured.length === 0 || captured.length === 1).toBe(true);
  });
});
