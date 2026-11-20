// Test support for the slice content: copies of forestSlice.json with one change each (design 9.3).
// The app cannot import world-view's testgen (the package exports only its two entry points), so the
// content mutations are written here. Test code only: nothing in the app imports this file.

type Key = string | number;

function walk(root: unknown, path: readonly Key[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    node = (node as Record<Key, unknown>)[key];
  }
  return node;
}

/** A deep copy of `json` with the value at `path` replaced by `value`. */
export function setAt(json: unknown, path: readonly Key[], value: unknown): unknown {
  const root = structuredClone(json);
  const last = path[path.length - 1];
  if (last === undefined) return value;
  (walk(root, path.slice(0, -1)) as Record<Key, unknown>)[last] = value;
  return root;
}

/** A deep copy of `json` with the key or index at `path` removed. */
export function dropAt(json: unknown, path: readonly Key[]): unknown {
  const root = structuredClone(json);
  const last = path[path.length - 1];
  if (last === undefined) return root;
  delete (walk(root, path.slice(0, -1)) as Record<Key, unknown>)[last];
  return root;
}

/** A deep copy of `json` with `value` appended to the array at `path`. */
export function pushAt(json: unknown, path: readonly Key[], value: unknown): unknown {
  const root = structuredClone(json);
  (walk(root, path) as unknown[]).push(value);
  return root;
}

/** The value at `path` of `json`, for building a mutation from an existing item. */
export function valueAt(json: unknown, path: readonly Key[]): unknown {
  return structuredClone(walk(json, path));
}
