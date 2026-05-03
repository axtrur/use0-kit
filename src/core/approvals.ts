import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadManifest } from "./manifest.js";
import type { PackResource } from "./types.js";

export type ApprovalRecord = {
  selector: string;
  digest: string;
  approvedBy: string;
  role?: string;
  approvedAt: string;
};

function approvalsPath(root: string): string {
  return join(root, ".use0-kit", "approvals.json");
}

export async function loadApprovals(root: string): Promise<ApprovalRecord[]> {
  try {
    return JSON.parse(await readFile(approvalsPath(root), "utf8")) as ApprovalRecord[];
  } catch {
    return [];
  }
}

export async function saveApprovals(root: string, approvals: ApprovalRecord[]): Promise<void> {
  await mkdir(join(root, ".use0-kit"), { recursive: true });
  await writeFile(approvalsPath(root), JSON.stringify(approvals, null, 2) + "\n", "utf8");
}

export async function approveSelector(
  root: string,
  selector: string,
  digest: string,
  approvedBy: string,
  role?: string
): Promise<void> {
  const approvals = await loadApprovals(root);
  const next = approvals.filter((item) => !(item.selector === selector && item.digest === digest));
  next.push({
    selector,
    digest,
    approvedBy,
    role,
    approvedAt: new Date().toISOString()
  });
  await saveApprovals(root, next);
}

export async function revokeApproval(root: string, selector: string, digest?: string): Promise<void> {
  const approvals = await loadApprovals(root);
  await saveApprovals(
    root,
    approvals.filter((item) => item.selector !== selector || (digest && item.digest !== digest))
  );
}

export async function listApprovals(root: string): Promise<ApprovalRecord[]> {
  return loadApprovals(root);
}

export async function checkPackApprovals(root: string): Promise<Array<{ selector: string; reason: string }>> {
  const manifest = await loadManifest(root);
  const approvals = await loadApprovals(root);
  const allowedApprovers = new Set(manifest.trust.allowedApprovers ?? []);
  const allowedRoles = new Set(manifest.trust.allowedApproverRoles ?? []);
  const issues: Array<{ selector: string; reason: string }> = [];

  for (const pack of manifest.packs) {
    const selector = `pack:${pack.id}`;
    if (!manifest.policy.requirePackApprovals) {
      continue;
    }
    if (!pack.signature?.digest) {
      issues.push({ selector, reason: "unsigned-pack" });
      continue;
    }
    const matches = approvals.filter((item) => item.selector === selector && item.digest === pack.signature?.digest);
    if (matches.length === 0) {
      issues.push({ selector, reason: "missing-approval" });
      continue;
    }
    const trusted = matches.some((approval) => {
      const byAllowed = allowedApprovers.size === 0 || allowedApprovers.has(approval.approvedBy);
      const roleAllowed = allowedRoles.size === 0 || (approval.role ? allowedRoles.has(approval.role) : false);
      return byAllowed && roleAllowed;
    });
    if (!trusted) {
      issues.push({ selector, reason: "untrusted-approval" });
    }
  }

  return issues;
}

export function packSignatureDigest(pack: PackResource): string | undefined {
  return pack.signature?.digest;
}
