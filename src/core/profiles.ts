import { syncScopesDetailed } from "./reconciliation.js";

export async function syncProfile(
  fromRoot: string,
  profileId: string,
  toRoot: string,
  options?: {
    mode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
    conflict?: "fail" | "ask" | "skip" | "parent-wins" | "child-wins" | "merge";
  }
): Promise<number> {
  return syncScopesDetailed({
    fromRoot,
    toRoot,
    selector: `profile:${profileId}`,
    originProfile: profileId,
    mode: options?.mode,
    conflict: options?.conflict
  });
}
