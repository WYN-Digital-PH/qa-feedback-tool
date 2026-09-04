import { supabase } from "@/integrations/supabase/client";

/**
 * Deleting records that own uploaded files.
 *
 * `canvas_files` rows cascade with their canvas, but the objects they point at
 * in the `canvas-files` bucket do not — nothing in Postgres reaches storage.
 * Deleting a canvas without this leaves every image and PDF ever uploaded to it
 * sitting in the bucket, billable and unreferenced.
 *
 * The order matters, and it is not the obvious one. Callers must:
 *
 *   1. `collectCanvasFilePaths()` — while the rows still exist to be read
 *   2. delete the record, and stop here if that fails
 *   3. `removeStoredFiles()` — only once the delete is known to have happened
 *
 * Purging first looks tidier but destroys a client's uploads whenever the
 * delete is then refused by RLS. An orphaned file after a failed step 3 is
 * merely waste; a deleted file behind a record that still exists is data loss.
 */

/** Canvas ids belonging to a project. */
export async function canvasIdsForProject(projectId: string): Promise<string[]> {
  const { data } = await supabase.from("canvases").select("id").eq("project_id", projectId);
  return (data ?? []).map((c) => c.id);
}

/** Canvas ids belonging to an agency, through its projects and directly. */
export async function canvasIdsForClient(clientId: string): Promise<string[]> {
  const [{ data: projects }, { data: direct }] = await Promise.all([
    supabase.from("projects").select("id").eq("client_id", clientId),
    supabase.from("canvases").select("id").eq("client_id", clientId),
  ]);

  const ids = new Set((direct ?? []).map((c) => c.id));
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length) {
    const { data } = await supabase.from("canvases").select("id").in("project_id", projectIds);
    for (const c of data ?? []) ids.add(c.id);
  }
  return [...ids];
}

/** Storage paths of every file uploaded to the given canvases. */
export async function collectCanvasFilePaths(canvasIds: string[]): Promise<string[]> {
  if (canvasIds.length === 0) return [];
  const { data } = await supabase.from("canvas_files").select("storage_path").in("canvas_id", canvasIds);
  return (data ?? []).map((f) => f.storage_path).filter(Boolean);
}

export interface PurgeResult {
  removed: number;
  /** Set when some objects survived — say so rather than claim a clean delete. */
  error: string | null;
}

/** Remove uploaded files from the bucket. Call only after the record is gone. */
export async function removeStoredFiles(paths: string[]): Promise<PurgeResult> {
  if (paths.length === 0) return { removed: 0, error: null };
  const { error } = await supabase.storage.from("canvas-files").remove(paths);
  return { removed: error ? 0 : paths.length, error: error?.message ?? null };
}
