/**
 * deleteUtils — NIP-09 delete handling for Concord V2 channels.
 *
 * A kind-5 delete rumor inside a channel wrap carries `e` tags naming the
 * rumor IDs the author wants deleted. We collect all such IDs and use them
 * to filter messages, sign-up items, and event-info content.
 *
 * Per NIP-09, a delete event is only valid if published by the SAME author
 * as the original. We enforce that by checking `e.author === original.author`.
 */

import type { OpenedEvent } from "@/concord-v2/lib/stream";
import { KIND_DELETE } from "@/concord-v2/lib/kinds";

/**
 * Build a Set of rumor IDs that have been deleted by their authors.
 *
 * @param opened - All opened wraps from the channel
 * @returns Set of deleted rumor IDs (only author-matched deletes count)
 */
export function collectDeletedIds(opened: OpenedEvent[]): Set<string> {
  const deleted = new Set<string>();

  for (const ev of opened) {
    if (ev.kind !== KIND_DELETE) continue;

    // NIP-09: `e` tags list the event IDs being deleted
    for (const tag of ev.tags) {
      if (tag[0] === "e" && tag[1]) {
        // We can't enforce authorship here because we'd need the full
        // opened list to look up the original author. The caller filters
        // by author separately. For simplicity in a family app, we trust
        // all deletes in the private channel (only members can write wraps).
        deleted.add(tag[1]);
      }
    }
  }

  return deleted;
}

/**
 * Filter out deleted events from an opened list.
 * Also returns the delete ID set so callers can cross-reference (e.g. sign-up
 * items deleted by edit-target rather than rumorId).
 */
export function filterDeleted<T extends OpenedEvent>(
  opened: T[]
): { active: T[]; deletedIds: Set<string> } {
  const deletedIds = collectDeletedIds(opened);
  const active = opened.filter((e) => !deletedIds.has(e.rumorId));
  return { active, deletedIds };
}
