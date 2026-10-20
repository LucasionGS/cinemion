import sequelize from "./sequelize.ts";
import Role from "./Role.ts";
import User from "./User.ts";
import Setting from "./Setting.ts";
import Library from "./Library.ts";
import MediaItem from "./MediaItem.ts";
import MediaFile from "./MediaFile.ts";
import Person from "./Person.ts";
import Credit from "./Credit.ts";

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
//#endregion

// Every user lookup needs the role for permission checks
User.addScope("defaultScope", { include: [{ model: Role, as: "role" }] }, { override: true });

export { Credit, Library, MediaFile, MediaItem, Person, Role, Setting, User };
export default sequelize;
