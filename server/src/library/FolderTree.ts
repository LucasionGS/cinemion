import { MediaItem } from "../models/index.ts";

/**
 * The folders and videos of Videos libraries as a tree, for counting and collecting everything inside a folder.
 * Built from parent ids rather than paths, so it works the same on SQLite and MariaDB.
 */
export class FolderTree {
  /**
   * Subfolders per folder id; `null` holds the library roots' folders.
   */
  private _folders = new Map<number | null, number[]>();
  /**
   * Videos per folder id; `null` holds videos in a library root.
   */
  private _videos = new Map<number | null, MediaItem[]>();

  private constructor(items: MediaItem[]) {
    for (const item of items) {
      if (item.type === "folder") this._folders.set(item.parentId, [...(this._folders.get(item.parentId) ?? []), item.id]);
      else this._videos.set(item.parentId, [...(this._videos.get(item.parentId) ?? []), item]);
    }
  }

  /**
   * Load the tree of the given libraries. Videos come with the fields used for sorting and thumbnails.
   */
  public static async load(libraryIds: number[]) {
    if (libraryIds.length === 0) return new FolderTree([]);
    const items = await MediaItem.findAll({
      where: { libraryId: [...new Set(libraryIds)], type: ["folder", "video"] },
      attributes: ["id", "libraryId", "parentId", "type", "folderPath", "sortTitle", "addedAt", "releaseDate", "ageRating", "artwork"],
    });
    return new FolderTree(items);
  }

  /**
   * The folder and every folder below it.
   */
  public foldersUnder(folderId: number): number[] {
    const result = [folderId];
    for (let i = 0; i < result.length; i++) result.push(...this._folders.get(result[i]) ?? []);
    return result;
  }

  /**
   * Every video inside the folder, subfolders included, sorted by folder and then title.
   */
  public videosUnder(folderId: number): MediaItem[] {
    return this.foldersUnder(folderId)
      .flatMap((id) => this._videos.get(id) ?? [])
      .sort((a, b) => (a.folderPath ?? "").localeCompare(b.folderPath ?? "") || a.sortTitle.localeCompare(b.sortTitle));
  }
}

export default FolderTree;
