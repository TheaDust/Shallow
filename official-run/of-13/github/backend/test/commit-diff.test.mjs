import assert from "node:assert/strict";
import test from "node:test";

import { diffSnapshots, lineDiff, splitContentLines } from "../src/lib/commit-diff.mjs";

function commit(files) {
  return {
    id: "commit-x",
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  };
}

test("content is split into lines without inventing a last empty line", () => {
  assert.deepEqual(splitContentLines(""), []);
  assert.deepEqual(splitContentLines("one"), ["one"]);
  assert.deepEqual(splitContentLines("one\n"), ["one"]);
  assert.deepEqual(splitContentLines("one\ntwo\n"), ["one", "two"]);
});

test("a line diff keeps context and marks the additions and deletions", () => {
  const { lines, additions, deletions } = lineDiff("# Title\nold\n", "# Title\nnew\nextra\n");
  assert.deepEqual(lines, [
    { type: "context", text: "# Title" },
    { type: "remove", text: "old" },
    { type: "add", text: "new" },
    { type: "add", text: "extra" },
  ]);
  assert.equal(additions, 2);
  assert.equal(deletions, 1);
});

test("an identical file produces no line at all", () => {
  const { lines, additions, deletions } = lineDiff("same\n", "same\n");
  assert.deepEqual(lines, [{ type: "context", text: "same" }]);
  assert.equal(additions, 0);
  assert.equal(deletions, 0);
});

test("a whole file counts as added or removed when it only exists on one side", () => {
  const added = lineDiff("", "one\ntwo\n");
  assert.deepEqual(added.lines, [
    { type: "add", text: "one" },
    { type: "add", text: "two" },
  ]);
  assert.equal(added.additions, 2);
  assert.equal(added.deletions, 0);

  const removed = lineDiff("one\n", "");
  assert.deepEqual(removed.lines, [{ type: "remove", text: "one" }]);
  assert.equal(removed.additions, 0);
  assert.equal(removed.deletions, 1);
});

test("the snapshot diff lists added, modified and removed files newest first and skips unchanged ones", () => {
  const base = commit({
    "README.md": "one\n",
    "docs/keep.md": "same\n",
  });
  const compare = commit({
    "README.md": "one\ntwo\n",
    "docs/keep.md": "same\n",
    "docs/new.md": "fresh\n",
  });

  const { files, additions, deletions } = diffSnapshots(base, compare);
  assert.deepEqual(
    files.map((file) => `${file.status}:${file.path}`),
    ["added:docs/new.md", "modified:README.md"],
  );
  assert.equal(additions, 2);
  assert.equal(deletions, 0);

  const removal = diffSnapshots(compare, base);
  assert.deepEqual(
    removal.files.map((file) => `${file.status}:${file.path}`),
    ["removed:docs/new.md", "modified:README.md"],
  );
});

test("an initial commit diff has no base and reports every file as added", () => {
  const { files, additions } = diffSnapshots(null, commit({ "README.md": "one\ntwo\n" }));
  assert.deepEqual(
    files.map((file) => `${file.status}:${file.path}`),
    ["added:README.md"],
  );
  assert.equal(additions, 2);
});
