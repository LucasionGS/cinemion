import sequelize from "./sequelize.ts";
import Role from "./Role.ts";
import User from "./User.ts";
import Setting from "./Setting.ts";
import Library from "./Library.ts";
import MediaItem from "./MediaItem.ts";
import MediaFile from "./MediaFile.ts";
import Person from "./Person.ts";
import Credit from "./Credit.ts";
import WatchState from "./WatchState.ts";
import Collection from "./Collection.ts";
import Activity from "./Activity.ts";
import Webhook from "./Webhook.ts";
import Playlist, { PlaylistItem } from "./Playlist.ts";
import PhotoAlbum, { PhotoAlbumItem } from "./PhotoAlbum.ts";
import ClipEmbedding from "./ClipEmbedding.ts";
import WatchlistItem from "./WatchlistItem.ts";

//#region Associations
User.belongsTo(Role, { as: "role", foreignKey: "roleId" });
Role.hasMany(User, { as: "users", foreignKey: "roleId" });
Role.belongsTo(Role, { as: "inherits", foreignKey: "inheritsId", constraints: false });

Library.hasMany(MediaItem, { as: "items", foreignKey: "libraryId", onDelete: "CASCADE" });
MediaItem.belongsTo(Library, { as: "library", foreignKey: "libraryId" });
MediaItem.hasMany(MediaItem, { as: "children", foreignKey: "parentId", onDelete: "CASCADE" });
MediaItem.belongsTo(MediaItem, { as: "parent", foreignKey: "parentId" });
MediaItem.hasMany(MediaFile, { as: "files", foreignKey: "itemId", onDelete: "CASCADE" });
MediaFile.belongsTo(MediaItem, { as: "item", foreignKey: "itemId" });
Library.hasMany(MediaFile, { as: "files", foreignKey: "libraryId", onDelete: "CASCADE" });
MediaItem.hasMany(Credit, { as: "credits", foreignKey: "itemId", onDelete: "CASCADE" });
Credit.belongsTo(MediaItem, { as: "item", foreignKey: "itemId" });
Credit.belongsTo(Person, { as: "person", foreignKey: "personId" });
Person.hasMany(Credit, { as: "credits", foreignKey: "personId", onDelete: "CASCADE" });
User.hasMany(WatchState, { as: "watchStates", foreignKey: "userId", onDelete: "CASCADE" });
WatchState.belongsTo(User, { as: "user", foreignKey: "userId" });
MediaItem.hasMany(WatchState, { as: "watchStates", foreignKey: "itemId", onDelete: "CASCADE" });
WatchState.belongsTo(MediaItem, { as: "item", foreignKey: "itemId" });
Library.hasMany(Collection, { as: "collections", foreignKey: "libraryId", onDelete: "CASCADE" });
Collection.belongsTo(Library, { as: "library", foreignKey: "libraryId" });
Collection.hasMany(MediaItem, { as: "items", foreignKey: "collectionId", onDelete: "SET NULL" });
MediaItem.belongsTo(Collection, { as: "collection", foreignKey: "collectionId" });
Activity.belongsTo(User, { as: "user", foreignKey: "userId", constraints: false });
Activity.belongsTo(MediaItem, { as: "item", foreignKey: "itemId", constraints: false });
User.hasMany(Playlist, { as: "playlists", foreignKey: "userId", onDelete: "CASCADE" });
Playlist.belongsTo(User, { as: "user", foreignKey: "userId" });
Playlist.hasMany(PlaylistItem, { as: "entries", foreignKey: "playlistId", onDelete: "CASCADE" });
PlaylistItem.belongsTo(Playlist, { as: "playlist", foreignKey: "playlistId" });
MediaItem.hasMany(PlaylistItem, { as: "playlistEntries", foreignKey: "itemId", onDelete: "CASCADE" });
PlaylistItem.belongsTo(MediaItem, { as: "item", foreignKey: "itemId" });
Library.hasMany(PhotoAlbum, { as: "photoAlbums", foreignKey: "libraryId", onDelete: "CASCADE" });
PhotoAlbum.belongsTo(Library, { as: "library", foreignKey: "libraryId" });
PhotoAlbum.belongsTo(User, { as: "owner", foreignKey: "userId", constraints: false });
PhotoAlbum.hasMany(PhotoAlbumItem, { as: "entries", foreignKey: "albumId", onDelete: "CASCADE" });
PhotoAlbumItem.belongsTo(PhotoAlbum, { as: "album", foreignKey: "albumId" });
MediaItem.hasMany(PhotoAlbumItem, { as: "photoAlbumEntries", foreignKey: "itemId", onDelete: "CASCADE" });
PhotoAlbumItem.belongsTo(MediaItem, { as: "item", foreignKey: "itemId" });
MediaItem.hasOne(ClipEmbedding, { as: "embedding", foreignKey: "itemId", onDelete: "CASCADE" });
ClipEmbedding.belongsTo(MediaItem, { as: "item", foreignKey: "itemId" });
User.hasMany(WatchlistItem, { as: "watchlist", foreignKey: "userId", onDelete: "CASCADE" });
WatchlistItem.belongsTo(User, { as: "user", foreignKey: "userId" });
MediaItem.hasMany(WatchlistItem, { as: "watchlistEntries", foreignKey: "itemId", onDelete: "SET NULL" });
WatchlistItem.belongsTo(MediaItem, { as: "item", foreignKey: "itemId" });
//#endregion

// Every user lookup needs the role for permission checks
User.addScope("defaultScope", { include: [{ model: Role, as: "role" }] }, { override: true });

export { Activity, ClipEmbedding, Collection, Credit, Library, MediaFile, MediaItem, Person, PhotoAlbum, PhotoAlbumItem, Playlist, PlaylistItem, Role, Setting, User, WatchlistItem, WatchState, Webhook };
export default sequelize;
