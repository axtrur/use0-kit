import { AGENTS } from "./agents.js";
import { loadResourceContent } from "./resources.js";
import { targetMatches } from "./targets.js";
import type { AgentId, InstructionResource } from "./types.js";

export function instructionMarkerStart(id: string): string {
  return `<!-- use0-kit:begin instruction:${id} -->`;
}

export function instructionMarkerEnd(id: string): string {
  return `<!-- use0-kit:end instruction:${id} -->`;
}

export async function renderInstructions(input: {
  root: string;
  instructions: InstructionResource[];
  agentId: AgentId;
}): Promise<{ path: string; content: string }> {
  const relevant = input.instructions.filter((instruction) =>
    targetMatches(instruction.targets, input.agentId)
  );
  const sections = await Promise.all(
    relevant.map(async (instruction) =>
      [
        instructionMarkerStart(instruction.id),
        (await loadResourceContent(input.root, instruction.source)).trimEnd(),
        instructionMarkerEnd(instruction.id)
      ].join("\n").trim()
    )
  );

  return {
    path: AGENTS[input.agentId].instructionPath(input.root),
    content: sections.join("\n\n") + (sections.length > 0 ? "\n" : "")
  };
}
