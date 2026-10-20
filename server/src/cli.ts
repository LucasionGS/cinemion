import AppSystem from "./AppSystem.ts";
import sequelize, { User } from "./models/index.ts";
import { runPendingMigrations } from "./migrate.ts";

/**
 * Maintenance commands for the server: `deno task cli <command>`.
 */

const HELP = `Cinemion ${AppSystem.VERSION} maintenance commands

  help [command]                   Show this help
  version                          Show the version
  users                            List every user
  reset-password <USERNAME>        Set a new password for a user
  remove-pin <USERNAME>            Remove the PIN from a profile

Run "cli help <command>" for more information on a command.`;

const USAGE: Record<string, string> = {
  "reset-password": `Set a new password for a user, for example when the only admin is locked out.
Usage: cli reset-password <USERNAME>`,
  "remove-pin": `Remove the PIN from a profile, so it opens from the profile picker without one.
Usage: cli remove-pin <USERNAME>`,
};

async function findUser(username: string | undefined) {
  if (!username) return null;
  const user = await User.findOne({ where: { username: username.toLowerCase() } });
  if (!user) console.error(`There's no user named "${username}". Run "cli users" to see them.`);
  return user;
}

async function listUsers() {
  const users = await User.findAll({ order: [["id", "ASC"]] });
  if (users.length === 0) {
    console.log("There are no users yet. Open Cinemion in a browser to run the setup.");
    return 0;
  }
  for (const user of users) {
    console.log(`  ${user.username.padEnd(24)} ${user.name.padEnd(24)} ${user.role?.name ?? ""}${user.pin ? "  (PIN)" : ""}`);
  }
  return 0;
}

async function resetPassword(username: string | undefined) {
  if (!username) {
    console.error(USAGE["reset-password"]);
    return 2;
  }
  const user = await findUser(username);
  if (!user) return 1;

  const password = prompt(`New password for ${user.username}:`);
  if (!password) {
    console.error("No password entered, nothing changed.");
    return 1;
  }
  try {
    await user.setPassword(password);
  } catch (error) {
    console.error((error as Error).message);
    return 3;
  }
  await user.save();
  console.log(`Done! The password for ${user.username} has been changed.`);
  return 0;
}

async function removePin(username: string | undefined) {
  if (!username) {
    console.error(USAGE["remove-pin"]);
    return 2;
  }
  const user = await findUser(username);
  if (!user) return 1;
  await user.setPin(null);
  await user.save();
  console.log(`Done! ${user.username} no longer has a PIN.`);
  return 0;
}

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case undefined:
    case "help":
      console.log(rest[0] && USAGE[rest[0]] ? USAGE[rest[0]] : HELP);
      return 0;
    case "version":
      console.log(AppSystem.VERSION);
      return 0;
    case "users":
    case "ls":
      return await listUsers();
    case "reset-password":
      return await resetPassword(rest[0]);
    case "remove-pin":
      return await removePin(rest[0]);
    default:
      console.error(`Command not found: ${command}\n\n${HELP}`);
      return 2;
  }
}

await AppSystem.init();
await runPendingMigrations();
const code = await main(Deno.args);
await sequelize.close();
Deno.exit(code);
