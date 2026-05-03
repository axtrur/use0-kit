import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function validateSkill(skillDir: string): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];
  try {
    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    if (!/^# /m.test(content)) {
      issues.push("Missing title heading.");
    }
    if (content.trim().length === 0) {
      issues.push("Skill content is empty.");
    }
  } catch {
    issues.push("Missing SKILL.md.");
  }

  return { valid: issues.length === 0, issues };
}

export async function scoreSkill(skillDir: string): Promise<number> {
  const validation = await validateSkill(skillDir);
  if (!validation.valid) {
    return 20;
  }
  const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
  let score = 60;
  if (content.includes("description")) score += 10;
  if (content.length > 40) score += 15;
  if (/```/.test(content)) score += 15;
  return Math.min(score, 100);
}
