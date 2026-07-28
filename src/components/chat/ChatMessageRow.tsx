/**
 * ChatMessageRow — single message with author avatar, name, and content.
 * Lightweight version of Armada's MessageRow.
 *
 * Interactions: long-press (touch, 500ms) or right-click (desktop) opens the
 * message action menu (react / reply / delete). Tapping a reaction chip
 * toggles that reaction for the viewer.
 */
import { memo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { X } from "lucide-react";
import { useAuthor, getDisplayName } from "@/hooks/useAuthor";
import type { ChatMessage } from "@/hooks/useChannelChat";

interface ChatMessageRowProps {
  msg: ChatMessage;
  isMine: boolean;
  /** Long-press / right-click → open the action menu at these coordinates. */
  onAction?: (msg: ChatMessage, x: number, y: number) => void;
  /** Tap on a reaction chip (toggle the viewer's reaction). */
  onReactionTap?: (msg: ChatMessage, emoji: string) => void;
}

/** Deterministic color from pubkey for avatar fallback */
function pubkeyColor(pubkey: string): string {
  const colors = [
    "#e11d48", "#ea580c", "#d97706", "#ca8a04", "#65a30d",
    "#0891b2", "#0284c7", "#4f46e5", "#7c3aed", "#c026d3",
  ];
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = ((hash << 5) - hash + pubkey.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

/** Tiny resolved display name (for quoted blocks). */
function AuthorName({ pubkey, className }: { pubkey: string; className?: string }) {
  const { data: profile } = useAuthor(pubkey);
  return <span className={className}>{getDisplayName(profile, pubkey)}</span>;
}

function MessageImages({ images }: { images: string[] }) {
  // In-app full-screen viewer — never punt the user out to a browser tab.
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  if (images.length === 0) return null;
  return (
    <>
      <div className={`mb-1 ${images.length > 1 ? "grid grid-cols-2 gap-1" : ""}`}>
        {images.map((url, i) => (
          <img
            key={i}
            src={url}
            alt="attachment"
            className="rounded-lg max-w-full max-h-48 object-cover cursor-pointer"
            loading="lazy"
            onClick={() => setViewerUrl(url)}
          />
        ))}
      </div>

      {viewerUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
          onClick={() => setViewerUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
        >
          <img
            src={viewerUrl}
            alt="attachment full view"
            className="max-h-full max-w-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setViewerUrl(null)}
            className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm active:bg-white/30"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}

/** Long-press (touch) + right-click (desktop) detection for the action menu. */
function useLongPress(onFire: (x: number, y: number) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });

  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return; // desktop uses contextmenu
      start.current = { x: e.clientX, y: e.clientY };
      const { clientX: x, clientY: y } = e;
      cancel();
      timer.current = window.setTimeout(() => {
        navigator.vibrate?.(10);
        onFire(x, y);
      }, 500);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!timer.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dx * dx + dy * dy > 144) cancel(); // 12px tolerance
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
      onFire(e.clientX, e.clientY);
    },
  };
}

export const ChatMessageRow = memo(function ChatMessageRow({ msg, isMine, onAction, onReactionTap }: ChatMessageRowProps) {
  const { data: profile } = useAuthor(msg.pubkey);
  const name = getDisplayName(profile, msg.pubkey);
  const color = pubkeyColor(msg.pubkey);
  const initial = name[0]?.toUpperCase() ?? "?";
  const time = new Date(msg.createdAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const meta = `${name} · ${time}${msg.edited ? " · edited" : ""}`;

  const longPress = useLongPress((x, y) => onAction?.(msg, x, y));

  const quoteBlock = msg.replyTo && (
    <div
      className={`mb-1 rounded-md border-l-2 px-2 py-1 text-xs ${
        isMine
          ? "border-white/60 bg-white/15 text-white/90"
          : "border-red-300 bg-orange-50 text-gray-600"
      }`}
    >
      <AuthorName pubkey={msg.replyTo.pubkey} className="font-semibold" />
      <span className="line-clamp-2 break-words"> {msg.replyTo.content}</span>
    </div>
  );

  const reactionsRow = msg.reactions && msg.reactions.length > 0 && (
    <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? "justify-end mr-10" : "ml-10"}`}>
      {msg.reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onReactionTap?.(msg, r.emoji)}
          aria-pressed={Boolean(r.myRumorId)}
          className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
            r.myRumorId
              ? "bg-red-100 border-red-300 font-semibold"
              : "bg-white border-orange-200 hover:bg-orange-50"
          }`}
        >
          {r.emoji} {r.count}
        </button>
      ))}
    </div>
  );

  if (isMine) {
    return (
      <div className={`flex flex-col items-end ${msg.pending ? "opacity-70" : ""}`}>
        <div className="flex items-end gap-2 max-w-[85%]">
          <div
            {...longPress}
            className="bg-red-600 text-white rounded-2xl rounded-br-sm px-3 py-2 text-[15px] leading-snug shadow-sm select-none [-webkit-touch-callout:none] cursor-default"
          >
            {quoteBlock}
            <MessageImages images={msg.images} />
            {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
          </div>
          <Avatar className="size-8 flex-shrink-0">
            <AvatarImage src={profile?.picture} alt={name} loading="lazy" />
            <AvatarFallback style={{ backgroundColor: `${color}33`, color }}>{initial}</AvatarFallback>
          </Avatar>
        </div>
        {reactionsRow}
        <p className="text-xs text-gray-400 mt-0.5 px-2 mr-10">
          {msg.pending ? "Sending…" : meta}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div className="flex items-end gap-2 max-w-[85%]">
        <Avatar className="size-8 flex-shrink-0">
          <AvatarImage src={profile?.picture} alt={name} loading="lazy" />
          <AvatarFallback style={{ backgroundColor: `${color}33`, color }}>{initial}</AvatarFallback>
        </Avatar>
        <div
          {...longPress}
          className="bg-white text-gray-900 border border-orange-100 rounded-2xl rounded-bl-sm px-3 py-2 text-[15px] leading-snug shadow-sm select-none [-webkit-touch-callout:none] cursor-default"
        >
          {quoteBlock}
          <MessageImages images={msg.images} />
          {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        </div>
      </div>
      {reactionsRow}
      <p className="text-xs text-gray-400 mt-0.5 px-2 ml-10">{meta}</p>
    </div>
  );
});
