# Review record: golden case `thin-slice`

- **Input:** the committed fixture `test/fixtures/thin-slice/repo`, scanned with
  `--repo-url http://gitea-http.gitea:3000/ops/thin-slice`, with no helm, no kustomize and no
  network (the case needs none of them, so `npm run verify` runs it).
- **Expected files:** `test/fixtures/thin-slice/expected.json` and `expected.txt`, kept beside the
  fixture (`expectedDir` in `input.json`) because the B1 to B6 tests read them there; this case
  points at them instead of copying them.
- **Who reviewed, when, what was checked:** this golden pins no new output. The expected files were
  produced by a real run and reviewed at B1 (2026-11-15; BUILD-NOTES, B1, "Edits to the expected
  output after the first real run": the cycle is the whole strongly connected component, 5 nodes
  and 8 edges, not the 3-node path first written; additive JSON fields), then edited at B2 and B6
  to the reviewed diff of a real run each time (BUILD-NOTES: B2, "Edits to the expected output
  (thin slice) after the first real run"; B2 merge of B6, "Expected outputs re-checked by hand at
  80 columns"). B7 (2026-11-16) checked that the golden lane's run, a child process of the built
  crankpath with node alone on PATH, `--cache-dir` outside the tree and `--no-color`, matches both
  files byte for byte (`npm run verify:golden`, `PASS  thin-slice: expected output`).
- **Edits in B7:** none.
- **Mutations (each must change the result):** `remove-service` (no cycle), `rename-service` (no
  cycle), `other-repo-url` (the Applications' repo is unreadable; 2 sources opaque).

## Pinned output (review m5)

`--pin` writes the expected files only when the run's output has these digests, which are those of the
output the review above saw:

expected.json sha-256: 018071369584d877297c21ee42732d2b7ae0de79b57f93f6d78bc36c37b9fe5e
expected.txt sha-256: 256f148e1760268e6698b23d822d5721255fa0cc35b18cf1c0895e1c95bd9334
