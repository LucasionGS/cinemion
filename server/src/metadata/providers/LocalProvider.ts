import fsp from "node:fs/promises";
import Path from "node:path";
import MetadataProvider from "../MetadataProvider.ts";
import Nfo from "../Nfo.ts";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * "Your files": NFO files and artwork that sit next to the videos.
 */
export class LocalProvider extends MetadataProvider {
  public readonly id = "local";
  public readonly name = "Your files";

  /**
   * Files in `folder`, by lowercase name, read once per lookup.
   */
  private async listFolder(folder: string) {
    const names = await fsp.readdir(folder).catch(() => [] as string[]);
    return new Map(names.map((n) => [n.toLowerCase(), Path.join(folder, n)]));
  }

  /**
   * The first image in `folder` named one of `baseNames` (any common image extension).
   */
  private findImage(files: Map<string, string>, baseNames: string[]) {
    for (const base of baseNames) {
      for (const ext of IMAGE_EXTENSIONS) {
        const found = files.get(`${base.toLowerCase()}${ext}`);
        if (found) return { file: found };
      }
    }
    return undefined;
  }

  public override async movie(query: MetadataProvider.MovieQuery): Promise<MetadataProvider.ItemMetadata | null> {
    const fileBase = query.files[0] ? Path.parse(query.files[0]).name : null;
    const folder = query.folder ?? (query.files[0] ? Path.dirname(query.files[0]) : null);
    if (!folder) return null;
    const files = await this.listFolder(folder);
    const bases = fileBase ? [fileBase] : [];

    const nfoPaths = [...query.files.map((f) => f.replace(/\.[^.]+$/, ".nfo"))];
    if (query.folder) nfoPaths.push(Path.join(query.folder, "movie.nfo"));
    const nfo = await Nfo.readFirst(nfoPaths);

    // Shared names like poster.jpg only belong to this movie when it has its own folder
    const own = (names: string[]) => [...bases.flatMap((b) => names.map((n) => `${b}-${n}`)), ...(query.folder ? names : [])];
    const artwork = {
      poster: this.findImage(files, own(["poster", "folder", "cover"])),
      backdrop: this.findImage(files, own(["fanart", "backdrop", "background"])),
      logo: this.findImage(files, own(["clearlogo", "logo"])),
      thumb: this.findImage(files, own(["thumb", "landscape"])),
    };

    if (!nfo && !Object.values(artwork).some(Boolean)) return null;
    return { ...nfo, artwork };
  }

  public override async show(query: MetadataProvider.ShowQuery): Promise<MetadataProvider.ShowMetadata | null> {
    const showFiles = await this.listFolder(query.folder);
    const nfo = await Nfo.readFirst([Path.join(query.folder, "tvshow.nfo")]);
    const seasons = new Map<number, MetadataProvider.SeasonMetadata>();

    for (const [number, season] of query.seasons) {
      const seasonFiles = season.folder ? await this.listFolder(season.folder) : new Map<string, string>();
      const padded = String(number).padStart(2, "0");
      const seasonName = number === 0 ? "season-specials" : `season${padded}`;
      const seasonNfo = season.folder ? await Nfo.readFirst([Path.join(season.folder, "season.nfo")]) : null;
      const poster = this.findImage(showFiles, [`${seasonName}-poster`]) ?? (season.folder ? this.findImage(seasonFiles, ["poster", "folder", "cover"]) : undefined);

      const episodes = new Map<number, MetadataProvider.ItemMetadata>();
      for (const [episode, paths] of season.episodes) {
        const first = paths[0];
        if (!first) continue;
        const base = Path.parse(first).name;
        const epNfo = await Nfo.readFirst([first.replace(/\.[^.]+$/, ".nfo")]);
        const folderFiles = Path.dirname(first) === season.folder ? seasonFiles : await this.listFolder(Path.dirname(first));
        const thumb = this.findImage(folderFiles, [`${base}-thumb`, base]);
        if (epNfo || thumb) episodes.set(episode, { ...epNfo, artwork: { thumb } });
      }

      seasons.set(number, { ...seasonNfo, artwork: { poster }, episodes });
    }

    const artwork = {
      poster: this.findImage(showFiles, ["poster", "folder", "cover"]),
      backdrop: this.findImage(showFiles, ["fanart", "backdrop", "background"]),
      logo: this.findImage(showFiles, ["clearlogo", "logo"]),
      thumb: this.findImage(showFiles, ["landscape", "thumb"]),
    };
    return { ...nfo, artwork, seasons };
  }
}

export default LocalProvider;
