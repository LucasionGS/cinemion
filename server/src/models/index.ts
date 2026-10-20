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
//#endregion

// Every user lookup needs the role for permission checks
User.addScope("defaultScope", { include: [{ model: Role, as: "role" }] }, { override: true });

export { Collection, Credit, Library, MediaFile, MediaItem, Person, Role, Setting, User, WatchState };
export default sequelize;
