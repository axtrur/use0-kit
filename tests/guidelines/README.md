# Guideline Tests

`tests/guidelines/specs/*.guideline.json` are executable counterparts for `docs/guidelines/GUIDELINE_*.md`.

Maintenance rules:

- Every `docs/guidelines/GUIDELINE_*.md` file must have one matching JSON spec.
- Every JSON spec must set `doc` to the guideline it validates.
- Every guideline must link back to its JSON spec.
- Behavior changes must update both the prose guide and the executable spec in the same change.

Run the suite with:

```bash
npm test -- tests/guidelines/guidelines.test.ts
```
