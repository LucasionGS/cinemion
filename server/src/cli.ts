import AppSystem from "./AppSystem.ts";
import sequelize, { User } from "./models/index.ts";
import { runPendingMigrations } from "./migrate.ts";
import Backups from "./backups/Backups.ts";

/**
 * Maintenance commands for the server: `cinemion <command>` with the binary, or `deno task cli <command>`.
 */

const HELP = `Cinemion ${AppSystem.VERSION}

Without a command, cinemion runs the server. Commands:

  help [command]                   Show this help
  version                          Show the version
  users                            List every user
  reset-password <USERNAME>        Set a new password for a user
  remove-pin <USERNAME>            Remove the PIN from a profile
  backup [--no-artwork]            Make a backup now
  restore <FILE> [--yes]           Replace everything with a backup

Commands use the same settings as the server (CONFIG_DIR, DB_DIALECT and so on), so run them as the
user the server runs as, e.g. "sudo -u cinemion cinemion users".

Run "cinemion help <command>" for more information on a command.`;

const USAGE: Record<string, string> = {
  "reset-password": `Set a new password for a user, for example when the only admin is locked out.
Usage: cinemion reset-password <USERNAME>`,
  "remove-pin": `Remove the PIN from a profile, so it opens from the profile picker without one.
Usage: cinemion remove-pin <USERNAME>`,
  backup: `Make a backup of the database, settings, profile pictures and artwork, into the backup folder
(Settings › Backups). It's protected with the password set there, if there is one.
Usage: cinemion backup [--no-artwork]

Options:
  --no-artwork   Leave downloaded artwork out (artwork made by hand is always included)`,
  restore: `Replace this server's database, settings, profile pictures and artwork with a backup. Stop the server
first. A password-protected backup asks for its password, or reads CINEMION_BACKUP_PASSWORD.
Usage: cinemion restore <FILE> [--yes]

Options:
  -y, --yes   Don't ask before replacing everything`,
};

async function findUser(username: string | undefined) {
  if (!username) return null;
  const user = await User.findOne({ where: { username: username.toLowerCase() } });
  if (!user) console.error(`There's no user named "${username}". Run "cinemion users" to see them.`);
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

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

async function backup(args: string[]) {
  const unknown = args.filter((a) => a !== "--no-artwork");
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown[0]}\n\n${USAGE.backup}`);
    return 2;
  }
  console.log("Making a backup...");
  try {
    const made = await Backups.make("manual", args.includes("--no-artwork") ? { artwork: false } : undefined);
    console.log(`Done! Saved ${formatBytes(made.size)} to ${await Backups.folder()}/${made.name}`);
    return 0;
  } catch (error) {
    console.error(`Could not make the backup: ${(error as Error).message}`);
    return 1;
  }
}

/**
 * Whether a Cinemion server answers on this machine's port, which must not run while its database is replaced.
 */
async function serverRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${AppSystem.config.PORT}/api/server`, { signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function restore(args: string[]) {
  const yes = args.includes("--yes") || args.includes("-y");
  const files = args.filter((a) => !a.startsWith("-"));
  const unknown = args.filter((a) => a.startsWith("-") && a !== "--yes" && a !== "-y");
  if (unknown.length > 0 || files.length !== 1) {
    console.error(unknown.length ? `Unknown option: ${unknown[0]}\n\n${USAGE.restore}` : USAGE.restore);
    return 2;
  }
  const file = files[0];
  if (!(await Deno.stat(file).then((s) => s.isFile).catch(() => false))) {
    console.error(`There's no file at ${file}.`);
    return 1;
  }
  if (await serverRunning()) {
    console.error(`Cinemion is running on port ${AppSystem.config.PORT}. Stop it first (for example "sudo systemctl stop cinemion"), then restore.`);
    return 1;
  }

  let password = Deno.env.get("CINEMION_BACKUP_PASSWORD") || null;
  let manifest: Backups.Manifest;
  try {
    manifest = await Backups.inspect(file, password);
  } catch (error) {
    if (!(error instanceof Backups.PasswordNeeded)) {
      console.error((error as Error).message);
      return 3;
    }
    password = prompt("This backup is protected. Password:");
    if (!password) {
      console.error("No password entered, nothing changed.");
      return 1;
    }
    try {
      manifest = await Backups.inspect(file, password);
    } catch (error) {
      console.error((error as Error).message);
      return 3;
    }
  }

  console.log(`This backup of "${manifest.serverName}" was made on ${new Date(manifest.createdAt).toLocaleString()} by Cinemion ${manifest.version}.`);
  if (!yes) {
    const answer = prompt("Replace everything on this server with it? [y/N]:");
    if (answer?.trim().toLowerCase() !== "y") {
      console.log("Nothing changed.");
      return 0;
    }
  }
  let last = "";
  try {
    await Backups.restore(file, password, (step) => {
      if (step !== last) console.log(`${step}...`);
      last = step;
    });
  } catch (error) {
    console.error(`Could not restore the backup: ${(error as Error).message}`);
    return 1;
  }
  console.log("Done! Start Cinemion again and sign in as before.");
  return 0;
}

/**
 * Commands that need the database.
 */
async function run(command: string, rest: string[]): Promise<number> {
  switch (command) {
    case "users":
    case "ls":
      return await listUsers();
    case "reset-password":
      return await resetPassword(rest[0]);
    case "remove-pin":
      return await removePin(rest[0]);
    case "backup":
      return await backup(rest);
    case "restore":
      return await restore(rest);
    default:
      console.error(`Command not found: ${command}\n\n${HELP}`);
      return 2;
  }
}

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  // Help and version don't touch the config folder, so they're safe to run anywhere (packaging checks run them)
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(rest[0] && USAGE[rest[0]] ? USAGE[rest[0]] : HELP);
      return 0;
    case "version":
    case "--version":
    case "-v":
      console.log(AppSystem.VERSION);
      return 0;
  }
  await AppSystem.init();
  await runPendingMigrations();
  try {
    return await run(command, rest);
  } finally {
    await sequelize.close();
  }
}

Deno.exit(await main(Deno.args));
