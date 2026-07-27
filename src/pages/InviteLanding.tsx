import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { parseInviteRoute } from "@/concord-v2/lib/invite";
import { EVENT_CONFIG } from "@/lib/eventConfig";

export default function InviteLanding() {
  const navigate = useNavigate();
  const { naddr } = useParams<{ naddr: string }>();
  const [status, setStatus] = useState<"processing" | "error" | "success">("processing");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!naddr) {
      setStatus("error");
      setErrorMsg("No invite specified");
      return;
    }

    // Get the fragment from the URL hash
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) {
      setStatus("error");
      setErrorMsg("Invite link is incomplete (missing secret fragment)");
      return;
    }

    const parsed = parseInviteRoute(naddr, hash);
    if (!parsed) {
      setStatus("error");
      setErrorMsg("Could not parse the invite link");
      return;
    }

    // In a full implementation, we would:
    // 1. Fetch the bundle event from the bootstrap relays
    // 2. Decrypt it with the token
    // 3. Store the community membership in the Community List
    // 4. Redirect to /app
    //
    // For now, show a message that the invite was received
    setStatus("success");

    // Auto-redirect after a brief delay
    setTimeout(() => navigate("/app"), 2000);
  }, [naddr, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-b from-orange-50 via-red-50 to-yellow-50">
      <div className="max-w-md w-full text-center space-y-4">
        {status === "processing" && (
          <>
            <div className="text-5xl animate-spin">🐚</div>
            <h2 className="text-xl font-semibold text-red-800">Processing invite...</h2>
            <p className="text-sm text-gray-600">Joining the {EVENT_CONFIG.name} community</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-5xl">😔</div>
            <h2 className="text-xl font-semibold text-red-800">Invite Error</h2>
            <p className="text-sm text-gray-600">{errorMsg}</p>
            <button
              onClick={() => navigate("/")}
              className="mt-4 text-sm text-red-600 hover:underline"
            >
              ← Back to home
            </button>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-semibold text-red-800">Welcome aboard!</h2>
            <p className="text-sm text-gray-600">Redirecting to the event...</p>
          </>
        )}
      </div>
    </div>
  );
}
