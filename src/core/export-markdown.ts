import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadRun, listRunIds } from "./run-persistence.js";
import { loadHandoff } from "./handoff-persistence.js";
import { redact } from "./redaction.js";
import type { Run } from "./types.js";

async function getRunChain(projectRoot: string, startRunId: string): Promise<Run[]> {
  const allRunIds = await listRunIds(projectRoot);
  const allRuns = await Promise.all(
    allRunIds.map((id) => loadRun(projectRoot, id).catch(() => null)),
  );
  const validRuns = allRuns.filter((r): r is Run => r !== null);

  // Find the root
  let rootId = startRunId;
  let current = validRuns.find((r) => r.run_id === rootId);
  while (current?.parent_run_id) {
    rootId = current.parent_run_id;
    current = validRuns.find((r) => r.run_id === rootId);
  }

  // Traverse down from root
  const chain: Run[] = [];
  let currentId: string | null = rootId;

  while (currentId) {
    const current = validRuns.find((r) => r.run_id === currentId);
    if (!current) break;
    chain.push(current);

    // Find next run in chain (assuming linear for now, or just taking the first child)
    const child = validRuns.find((r) => r.parent_run_id === currentId);
    currentId = child ? child.run_id : null;
  }

  return chain;
}

export async function exportRunToMarkdown(
  projectRoot: string,
  runId: string,
  exportId: string,
): Promise<string> {
  const chain = await getRunChain(projectRoot, runId);
  if (chain.length === 0) {
    throw new Error(`Run not found: ${runId}`);
  }

  const lines: string[] = [];
  lines.push("# Relay Run Export");
  lines.push("");

  for (const run of chain) {
    lines.push(`## Run: ${run.run_id}`);
    lines.push(`**Provider:** ${run.provider}`);
    lines.push(`**Role:** ${run.role}`);
    lines.push(`**Status:** ${run.status}`);
    lines.push(`**Estimated Tokens:** ${String(run.estimated_tokens)}`);
    if (run.started_at) lines.push(`**Started At:** ${run.started_at}`);
    if (run.ended_at) lines.push(`**Ended At:** ${run.ended_at}`);
    lines.push("");

    if (run.handoff_id) {
      try {
        const handoff = await loadHandoff(projectRoot, run.handoff_id);
        lines.push("### Handoff");
        lines.push(`**Handoff ID:** ${handoff.handoff_id}`);
        lines.push(`**Target Provider:** ${handoff.target_provider}`);
        lines.push(`**Title:** ${handoff.title}`);
        lines.push(`**Objective:** ${handoff.objective}`);
        lines.push("");
      } catch {
        // Ignore if handoff doesn't exist
      }
    }

    let promptContent = "";
    try {
      promptContent = await fs.readFile(run.prompt_path, "utf-8");
    } catch {
      // Ignore
    }

    if (promptContent) {
      lines.push("### Prompt");
      lines.push("```markdown");
      lines.push(redact(promptContent));
      lines.push("```");
      lines.push("");
    }

    let finalOutput = "";
    try {
      finalOutput = await fs.readFile(run.final_output_path, "utf-8");
    } catch {
      // Ignore
    }

    if (finalOutput) {
      lines.push("### Final Output");
      lines.push("```markdown");
      lines.push(redact(finalOutput));
      lines.push("```");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  const exportContent = lines.join("\n");
  const exportPath = path.join(projectRoot, ".relay", "exports", `${exportId}.md`);

  await fs.mkdir(path.dirname(exportPath), { recursive: true });
  await fs.writeFile(exportPath, exportContent, "utf-8");

  return exportPath;
}
