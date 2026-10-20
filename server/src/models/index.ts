import sequelize from "./sequelize.ts";
import Role from "./Role.ts";
import User from "./User.ts";
import Setting from "./Setting.ts";
import Library from "./Library.ts";

//#region Associations
User.belongsTo(Role, { as: "role", foreignKey: "roleId" });
Role.hasMany(User, { as: "users", foreignKey: "roleId" });
Role.belongsTo(Role, { as: "inherits", foreignKey: "inheritsId", constraints: false });
//#endregion

// Every user lookup needs the role for permission checks
User.addScope("defaultScope", { include: [{ model: Role, as: "role" }] }, { override: true });

export { Library, Role, Setting, User };
export default sequelize;
