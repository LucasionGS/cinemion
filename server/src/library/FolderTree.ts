import { MediaItem } from "../models/index.ts";

/**
 * The folders of Videos and Photos libraries with the videos and photos in them, as a tree, for counting and
 * collecting everything inside a folder. Built from parent ids rather than paths, so it works the same on SQLite and
 * MariaDB.
 */
export class FolderTree {
  /**
   * Subfolders per folder id; `null` holds the library roots' folders.
   */
  private _folders = new Map<number | null, number[]>();
  /**
   * Videos and photos per folder id; `null` holds those in a library root.
   */
  private _items = new Map<number | null, MediaItem[]>();

  private constructor(items: MediaItem[]) {
    for (const item of items) {
      if (item.type === "folder") this._folders.set(item.parentId, [...(this._folders.get(item.parentId) ?? []), item.id]);
      else this._items.set(item.parentId, [...(this._items.get(item.parentId) ?? []), item]);
    }
  }

  /**
   * Load the tree of the given libraries. Videos and photos come with the fields used for sorting, counting and
   * thumbnails.
   */
  public static async load(libraryIds: number[]) {
    if (libraryIds.length === 0) return new FolderTree([]);
    const items = await MediaItem.findAll({
      where: { libraryId: [...new Set(libraryIds)], type: ["folder", "video", "photo"] },
      attributes: ["id", "libraryId", "parentId", "type", "folderPath", "sortTitle", "addedAt", "releaseDate", "takenAt", "ageRating", "artwork"],
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
   * Every video and photo inside the folder, subfolders included, sorted by folder and then title.
   */
  public itemsUnder(folderId: number): MediaItem[] {
    return this.foldersUnder(folderId)
      .flatMap((id) => this._items.get(id) ?? [])
      .sort((a, b) => (a.folderPath ?? "").localeCompare(b.folderPath ?? "") || a.sortTitle.localeCompare(b.sortTitle));
  }

  /**
   * Every video inside the folder, subfolders included, sorted by folder and then title.
   */
  public videosUnder(folderId: number): MediaItem[] {
    return this.itemsUnder(folderId).filter((i) => i.type === "video");
  }
}

export default FolderTree;
