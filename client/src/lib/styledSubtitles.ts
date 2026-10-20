import type JASSUB from "jassub";

/**
 * Whether this browser can draw ASS subtitles with their own styling (libass in WebAssembly, drawn off-screen).
 */
export function canRenderStyled() {
  return typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly === "object";
}

/**
 * Draw an ASS file over `video` with its own fonts, colours and positions. The renderer is loaded the first time,
 * so players without styled subtitles never download it.
 * @param fontsUrl Lists the fonts attached to the video, which styled subtitles are usually written for.
 * @param offset Where the stream starts in the file. Unit is in seconds.
 */
export async function renderStyled(video: HTMLVideoElement, assUrl: string, fontsUrl: string, offset: number): Promise<JASSUB> {
  const [{ default: Renderer }, fonts] = await Promise.all([
    import("jassub"),
    fetch(fontsUrl).then((res) => res.ok ? res.json() as Promise<string[]> : []).catch(() => [] as string[]),
  ]);
  // Font addresses are fetched by the renderer's worker, which resolves them against its own script
  const absolute = fonts.map((f) => new URL(f, location.origin).toString());
  const renderer = new Renderer({ video, subUrl: new URL(assUrl, location.origin).toString(), fonts: absolute, timeOffset: offset });
  await renderer.ready;
  return renderer;
}
