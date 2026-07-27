/**
 * ChatMessageRow — single message with author avatar, name, and content.
 * Lightweight version of Armada's MessageRow.
 */
import { memo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trash2, X } from "lucide-react";
import { useAuthor, getDisplayName } from "@/hooks/useAuthor";
import type { ChatMessage } from "@/hooks/useChannelChat";

interface ChatMessageRowProps {
  msg: ChatMessage;
  isMine: boolean;
  onDelete?: (rumorId: string) => void;
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

export const ChatMessageRow = memo(function ChatMessageRow({ msg, isMine, onDelete }: ChatMessageRowProps) {
  const { data: profile } = useAuthor(msg.pubkey);
  const name = getDisplayName(profile, msg.pubkey);
  const color = pubkeyColor(msg.pubkey);
  const initial = name[0]?.toUpperCase() ?? "?";
  const time = new Date(msg.createdAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const meta = `${name} · ${time}${msg.edited ? " · edited" : ""}`;

  if (isMine) {
    return (
      <div className={`group/msg flex flex-col items-end ${msg.pending ? "opacity-70" : ""}`}>
        <div className="flex items-end gap-2 max-w-[85%]">
          {onDelete && (
            <button
              onClick={() => onDelete(msg.id)}
              className="opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 max-sm:opacity-40 transition-opacity self-center text-gray-400 hover:text-red-600 p-2 -m-1"
              title="Delete message"
            >
              <Trash2 size={14} />
            </button>
          )}
          <div className="bg-red-600 text-white rounded-2xl rounded-br-sm px-3 py-2 text-[15px] leading-snug shadow-sm">
            <MessageImages images={msg.images} />
            {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
          </div>
          <Avatar className="size-8 flex-shrink-0">
            <AvatarImage src={profile?.picture} alt={name} loading="lazy" />
            <AvatarFallback style={{ backgroundColor: `${color}33`, color }}>{initial}</AvatarFallback>
          </Avatar>
        </div>
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
        <div className="bg-white text-gray-900 border border-orange-100 rounded-2xl rounded-bl-sm px-3 py-2 text-[15px] leading-snug shadow-sm">
          <MessageImages images={msg.images} />
          {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-0.5 px-2 ml-10">{meta}</p>
    </div>
  );
});
