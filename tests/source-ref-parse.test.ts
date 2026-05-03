import { describe, expect, test } from "vitest";

import { parseSourceReference } from "../src/core/source-resolver.js";

describe("source reference parsing", () => {
  test("parses github gitlab and ssh source references", () => {
    expect(parseSourceReference("github:vercel-labs/agent-skills@v1.2.0#skills/review")).toEqual({
      scheme: "git",
      repo: "https://github.com/vercel-labs/agent-skills.git",
      ref: "v1.2.0",
      subpath: "skills/review"
    });

    expect(parseSourceReference("gitlab:acme/agent-resources#skills/frontend-review")).toEqual({
      scheme: "git",
      repo: "https://gitlab.com/acme/agent-resources.git",
      ref: undefined,
      subpath: "skills/frontend-review"
    });

    expect(parseSourceReference("ssh:git@github.com:owner/repo.git@main#skills/core")).toEqual({
      scheme: "git",
      repo: "git@github.com:owner/repo.git",
      ref: "main",
      subpath: "skills/core"
    });
  });
});
