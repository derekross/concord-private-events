/**
 * Simple file upload via Blossom (BUD-02).
 * Uploads to configured Blossom servers and returns NIP-94 tags.
 */
import { BlossomUploader } from "@nostrify/nostrify/uploaders";
import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppContext } from "@/hooks/useAppContext";

export function useUploadFile() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Must be logged in to upload files");

      const servers = config.blossomServerMetadata.servers.length > 0
        ? config.blossomServerMetadata.servers
        : ["https://blossom.primal.net", "https://cdn.nostrcheck.me"];

      const uploader = new BlossomUploader({
        servers,
        signer: user.signer,
        fetch: (input, init) =>
          globalThis.fetch(input, {
            ...init,
            signal: AbortSignal.any([
              init?.signal ?? AbortSignal.timeout(30_000),
              AbortSignal.timeout(30_000),
            ]),
          }),
      });

      const tags = await uploader.upload(file);
      // Repair doubled scheme some Blossom servers emit
      const urlTag = tags.find((t) => t[0] === "url") ?? tags[0];
      if (urlTag && urlTag[1]) {
        urlTag[1] = urlTag[1].replace(/^(https?):\/\/https?:?\/\//i, "$1://");
      }
      return tags;
    },
  });
}
