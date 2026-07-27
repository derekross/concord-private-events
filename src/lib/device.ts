/**
 * Device detection for picker UX (Apple Maps/Calendar vs Google).
 *
 * True on iOS AND macOS — on a Mac, maps.apple.com opens the Maps app and a
 * downloaded .ics opens Calendar.app, so Apple-first is correct there too.
 */
export function isAppleDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as MacIntel; distinguish by touch.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    /^Mac/.test(navigator.platform)
  );
}
