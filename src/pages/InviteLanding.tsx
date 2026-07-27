import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { parseInviteRoute } from "@/concord-v2/lib/invite";
import { EVENT_CONFIG } from "@/lib/eventConfig";

type InviteStatus =
  | { status: "success" }
  | { status: "error"; errorMsg: string };

/** Parse the invite route once (pure) — no effect needed for derivation. */
function parseInvite(naddr: string | undefined): InviteStatus {
  if (!naddr) {
    return { status: "error", errorMsg: "No invite specified" };
  }
  // Get the fragment from the URL hash
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) {
    return { status: "error", errorMsg: "Invite link is incomplete (missing secret fragment)" };
  }
  const parsed = parseInviteRoute(naddr, hash);
  if (!parsed) {
    return { status: "error", errorMsg: "Could not parse the invite link" };
  }
  return { status: "success" };
}

export default function InviteLanding() {
  const navigate = useNavigate();
  const { naddr } = useParams<{ naddr: string }>();
  const [invite] = useState<InviteStatus>(() => parseInvite(naddr));

  // Auto-redirect after a brief delay once the invite parses.
  useEffect(() => {
    if (invite.status !== "success") return;
    const timer = setTimeout(() => navigate("/app"), 2000);
    return () => clearTimeout(timer);
  }, [invite.status, navigate]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      <div className="max-w-md w-full text-center space-y-4">
        {invite.status === "error" && (
          <>
            <div className="text-5xl">😔</div>
            <h2 className="text-xl font-semibold text-red-800">Invite Error</h2>
            <p className="text-sm text-gray-600">{invite.errorMsg}</p>
            <button
              onClick={() => navigate("/")}
              className="mt-4 text-sm text-red-600 hover:underline"
            >
              ← Back to home
            </button>
          </>
        )}

        {invite.status === "success" && (
          <>
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-semibold text-red-800">Welcome aboard!</h2>
            <p className="text-sm text-gray-600">
              Joining the {EVENT_CONFIG.name} community. Redirecting to the event...
            </p>
          </>
        )}
      </div>
    </div>
  );
}
