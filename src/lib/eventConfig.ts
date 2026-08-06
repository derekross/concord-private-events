/**
 * App-level configuration.
 *
 * This app is a private-event companion for ANY Concord V2 community: event
 * details, a sign-up board, and encrypted group chat. It is not tied to a
 * particular community — users sign in, pick one of their communities, and the
 * community's own name, icon, banner and description drive the UI.
 *
 * Nothing here identifies a community. Community identity, ownership and keys
 * all come from the user's encrypted Community List and the control-plane fold,
 * never from this file — a deployment config has no business making
 * authorization decisions.
 */

/**
 * Fallback branding, used only before any community context exists: the
 * logged-out landing page, the picker, and loading states. Once a community is
 * open, its folded metadata takes over.
 */
export const APP_BRANDING = {
  name: "Concord Private Events",
  emoji: "🎉",
  subtitle: "Plan your gathering, together",
} as const;

/**
 * Preferred channel names per app slot. These are PREFERENCES, not
 * requirements: no channel setup is needed, because every feature (chat,
 * events, RSVPs, sign-up board) works inside a single "general" channel —
 * kinds distinguish the content. A dedicated channel with one of these names
 * takes priority when it exists.
 */
export const CHANNEL_PREFERENCES = {
  eventInfo: "event-info",
  signUp: "sign-up",
  chat: "chat",
} as const;

/** The full-featured Concord client, for deep links out of this app. */
export const ARMADA_BASE = "https://armada.buzz";
