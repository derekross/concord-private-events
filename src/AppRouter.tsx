import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { ErrorBoundary } from "./components/ErrorBoundary";

import Landing from "./pages/Landing";
import AppPage from "./pages/AppPage";
import LegacyAppRedirect from "./pages/LegacyAppRedirect";
import InviteLanding from "./pages/InviteLanding";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ErrorBoundary>
        <Routes>
          {/* Community picker */}
          <Route path="/" element={<Landing />} />
          {/* One community. Two segments, so it outranks the /:nip19 catch-all. */}
          <Route path="/c/:communityId" element={<AppPage />} />
          {/* Legacy: bookmarks and the cached service-worker shell still hit /app */}
          <Route path="/app" element={<LegacyAppRedirect />} />
          <Route path="/invite/:naddr" element={<InviteLanding />} />
          {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
          <Route path="/:nip19" element={<NIP19Page />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
export default AppRouter;
