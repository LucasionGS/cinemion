import type { CreatePhotoAlbumRequest, PhotoAlbumDetail, PhotoAlbumSort, PhotoAlbumSummary, PhotoDetail, PhotoPage, PhotosOverview, UpdatePhotoAlbumRequest } from "@shared/photos.ts";
import type { ItemSummary } from "@shared/media.ts";
import BaseApi from "./BaseApi.ts";

export namespace PhotosApi {
  const PAGE_SIZE = 200;

  function paging(offset: number, limit = PAGE_SIZE) {
    return `offset=${offset}&limit=${limit}`;
  }

  export function overview(libraryId: number, sort: PhotoAlbumSort = "newest") {
    return BaseApi.GET<PhotosOverview>(`/photos/libraries/${libraryId}?sort=${sort}`);
  }

  /**
   * Photos and videos of a library, newest first: all of them, or only those outside every folder.
   */
  export function libraryItems(libraryId: number, scope: "all" | "loose", offset: number) {
    return BaseApi.GET<PhotoPage>(`/photos/libraries/${libraryId}/items?scope=${scope}&${paging(offset)}`);
  }

  export function folder(id: number) {
    return BaseApi.GET<PhotoAlbumDetail>(`/photos/folders/${id}`);
  }

  /**
   * Photos and videos in a folder, or with `all` also those in its subfolders.
   */
  export function folderItems(id: number, offset: number, all = false) {
    return BaseApi.GET<PhotoPage>(`/photos/folders/${id}/items?${paging(offset)}${all ? "&all=1" : ""}`);
  }

  /**
   * Every page of a list, one after the other.
   */
  export async function everything(load: (offset: number) => Promise<PhotoPage>) {
    const items: PhotoPage["items"] = [];
    while (true) {
      const page = await load(items.length);
      items.push(...page.items);
      if (page.items.length === 0 || items.length >= page.total) return items;
    }
  }

  /**
   * Use a photo as a folder's cover, or `null` to go back to the automatic one.
   */
  export function setFolderCover(id: number, itemId: number | null) {
    return BaseApi.PUT<PhotoAlbumSummary>(`/photos/folders/${id}/cover`, { itemId });
  }

  /**
   * Hand-made albums in a library; with `editable`, only those this profile may add to.
   */
  export function albums(libraryId: number, editable = false) {
    return BaseApi.GET<PhotoAlbumSummary[]>(`/photos/albums?libraryId=${libraryId}${editable ? "&editable=1" : ""}`);
  }

  export function album(id: number) {
    return BaseApi.GET<PhotoAlbumDetail>(`/photos/albums/${id}`);
  }

  export function albumItems(id: number, offset: number) {
    return BaseApi.GET<PhotoPage>(`/photos/albums/${id}/items?${paging(offset)}`);
  }

  export function createAlbum(data: CreatePhotoAlbumRequest) {
    return BaseApi.POST<PhotoAlbumSummary>("/photos/albums", data);
  }

  export function updateAlbum(id: number, data: UpdatePhotoAlbumRequest) {
    return BaseApi.PATCH<PhotoAlbumSummary>(`/photos/albums/${id}`, data);
  }

  export function deleteAlbum(id: number) {
    return BaseApi.DELETE<void>(`/photos/albums/${id}`);
  }

  export function addToAlbum(id: number, itemIds: number[]) {
    return BaseApi.POST<PhotoAlbumSummary & { added: number }>(`/photos/albums/${id}/items`, { itemIds });
  }

  export function removeFromAlbum(id: number, itemIds: number[]) {
    return BaseApi.POST<PhotoAlbumSummary>(`/photos/albums/${id}/remove`, { itemIds });
  }

  export function get(id: number) {
    return BaseApi.GET<PhotoDetail>(`/photos/${id}`);
  }

  /**
   * Save a photo's caption, date, tags and rating (the same call "Edit details" uses for videos).
   */
  export function editDetails(id: number, details: { title: string; releaseDate: string | null; overview: string | null; tags: string[]; contentRating: string | null }) {
    return BaseApi.PUT<ItemSummary>(`/items/${id}/details`, details);
  }
}

export default PhotosApi;
