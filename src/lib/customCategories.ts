/**
 * Custom sign-up board categories — makes the board work for any event.
 * There are no built-in categories: every board grows its own (name + emoji),
 * persisted locally PER COMMUNITY. Items carry the category name inside the
 * encrypted channel, so custom categories sync through the ordinary sign-up
 * rumors — the emoji is the only local bit (others see a sensible fallback
 * until they name it themselves).
 */

import { useState } from "react";

export interface CustomCategory {
  /** Display name (matching is case-insensitive). */
  name: string;
  emoji: string;
}

/**
 * Emoji for the original seafood-boil categories. Kept — not deleted — because
 * existing boards still hold items filed under these names, and they'd lose
 * their emoji otherwise. New boards create their own categories.
 */
export const LEGACY_CATEGORY_EMOJI: Record<string, string> = {
  seafood: "🦐",
  drinks: "🥤",
  sides: "🥗",
  supplies: "🍽️",
  volunteer: "🙋",
};

/** The pre-multi-community global key, migrated once per community. */
const LEGACY_KEY = "concord-events:custom-categories";
const MIGRATED_FLAG = "concord-events:custom-categories:migrated";

function storageKey(communityId: string) {
  return `${LEGACY_KEY}:${communityId}`;
}

/**
 * One-time copy of the old global list into the first community opened after
 * upgrading. Every pre-existing user had exactly one community, so this lands
 * the categories where they belong. Copy rather than move: leaving the legacy
 * key costs nothing and keeps the data recoverable.
 */
function migrateLegacy(communityId: string) {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !localStorage.getItem(storageKey(communityId))) {
      localStorage.setItem(storageKey(communityId), legacy);
    }
    localStorage.setItem(MIGRATED_FLAG, "1");
  } catch {
    // best-effort
  }
}

export function loadCustomCategories(communityId: string | undefined): CustomCategory[] {
  if (!communityId) return [];
  migrateLegacy(communityId);
  try {
    const raw = localStorage.getItem(storageKey(communityId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is CustomCategory =>
        c && typeof c.name === "string" && typeof c.emoji === "string"
    );
  } catch {
    return [];
  }
}

function persist(communityId: string, categories: CustomCategory[]) {
  try {
    localStorage.setItem(storageKey(communityId), JSON.stringify(categories));
  } catch {
    // best-effort
  }
}

/** Hook: this community's custom categories + add/remove. */
export function useCustomCategories(communityId: string | undefined) {
  const [customs, setCustoms] = useState<CustomCategory[]>(() =>
    loadCustomCategories(communityId)
  );

  // useState's initializer runs ONCE. Without this, switching community without
  // a remount would show the previous community's categories and, worse, write
  // them back under the new community's key. Adjusting state during render is
  // the supported React pattern for "derive from props" (same approach as
  // useDecryptedImage).
  const [prevId, setPrevId] = useState(communityId);
  if (prevId !== communityId) {
    setPrevId(communityId);
    setCustoms(loadCustomCategories(communityId));
  }

  const addCustomCategory = (name: string, emoji: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || !emoji) return false;
    const key = trimmed.toLowerCase();
    if (customs.some((c) => c.name.toLowerCase() === key)) {
      return false; // already exists
    }
    if (!communityId) return false;
    const next = [...customs, { name: trimmed, emoji }];
    setCustoms(next);
    persist(communityId, next);
    return true;
  };

  const removeCustomCategory = (name: string) => {
    const key = name.toLowerCase();
    if (!communityId) return;
    const next = customs.filter((c) => c.name.toLowerCase() !== key);
    if (next.length === customs.length) return;
    setCustoms(next);
    persist(communityId, next);
  };

  return { customs, addCustomCategory, removeCustomCategory };
}

/** Emoji for any category key: built-in → custom → fallback pin. */
export function categoryEmoji(category: string, customs: CustomCategory[]): string {
  const builtIn = LEGACY_CATEGORY_EMOJI[category];
  if (builtIn) return builtIn;
  const custom = customs.find((c) => c.name.toLowerCase() === category.toLowerCase());
  return custom?.emoji ?? "📌";
}

/** "🦐 Seafood"-style label for any category key. */
export function categoryLabel(category: string, customs: CustomCategory[]): string {
  const emoji = categoryEmoji(category, customs);
  const custom = customs.find((c) => c.name.toLowerCase() === category.toLowerCase());
  const name = custom?.name ?? category.charAt(0).toUpperCase() + category.slice(1);
  return `${emoji} ${name}`;
}

/** Emoji choices offered when creating a custom category. */
export const EMOJI_CHOICES = [
  "🎉", "🎂", "🎈", "🎁", "🍕", "🌮", "🍔", "🌭",
  "🍩", "🍰", "🧁", "🍪", "🥨", "🍿", "🥤", "🧃",
  "☕", "🍷", "🍺", "🎵", "🏕️", "⚽", "🎲", "🪴",
];
