import { existsSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Locate the pnpm workspace root that contains packages/database-pg.
 *
 * Standalone Docker:  /app/api/scripts → /app
 * Monorepo Docker:    /app/backend/api/scripts → /app
 */
export function resolveWorkspaceRoot(apiRoot) {
  const candidates = [
    join(apiRoot, ".."),
    join(apiRoot, "..", ".."),
  ];

  for (const root of candidates) {
    if (existsSync(join(root, "packages", "database-pg", "package.json"))) {
      return root;
    }
  }

  throw new Error(
    `[workspace] Could not find packages/database-pg from ${apiRoot} (parent=${basename(join(apiRoot, ".."))})`,
  );
}
