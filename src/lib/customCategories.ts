/**
 * Custom sign-up board categories — makes the board work for any event,
 * not just a boil. Built-in categories live in eventConfig; users can add
 * their own (name + emoji), persisted locally. Items carry the category
 * name inside the encrypted channel, so custom categories sync through the
 * ordinary sign-up rumors — the emoji is the only local bit (others see a
 * sensible fallback until they name it themselves).
 */

import { useState } from "react";
import { CATEGORY_EMOJI } from "@/lib/eventConfig";

export interface CustomCategory {
  /** Display name (matching is case-insensitive). */
  name: string;
  emoji: string;
}

const STORAGE_KEY = "concord-events:custom-categories";

export function loadCustomCategories(): CustomCategory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

function persist(categories: CustomCategory[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
  } catch {
    // best-effort
  }
}

/** Hook: the user's custom categories + an add function. */
export function useCustomCategories() {
  const [customs, setCustoms] = useState<CustomCategory[]>(loadCustomCategories);

  const addCustomCategory = (name: string, emoji: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || !emoji) return false;
    const key = trimmed.toLowerCase();
    if (
      customs.some((c) => c.name.toLowerCase() === key) ||
      key in CATEGORY_EMOJI
    ) {
      return false; // already exists
    }
    const next = [...customs, { name: trimmed, emoji }];
    setCustoms(next);
    persist(next);
    return true;
  };

  return { customs, addCustomCategory };
}

/** Emoji for any category key: built-in → custom → fallback pin. */
export function categoryEmoji(category: string, customs: CustomCategory[]): string {
  const builtIn = CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI];
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
