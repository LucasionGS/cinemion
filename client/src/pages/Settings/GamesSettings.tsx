import { useEffect, useState } from "react";
import { Download, ScanEye, Trash2 } from "lucide-react";
import type { ClipsSettings } from "@shared/clips.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import { session } from "../../Session.ts";
import { usePoll } from "../../lib/usePoll.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatBytes, formatPercent } from "../../lib/format.ts";
import Button from "../../components/Button/Button.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";

const POLL_DOWNLOADING_MS = 1500;
const POLL_MS = 15_000;

/**
 * Where games in Clips libraries get their names and artwork, and picture recognition for clips without a game.
 * Shown on the Metadata page.
 */
export default function GamesSettings() {
  const [saved, setSaved] = useState<ClipsSettings | null>(null);
  const [value, setValue] = useState<ClipsSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const recognition = usePoll(() => ClipsApi.recognition(), downloading ? POLL_DOWNLOADING_MS : POLL_MS);
  const status = recognition.data;

  useEffect(() => {
    ClipsApi.settings().then((s) => {
      setSaved(s);
      setValue(s);
    }).catch((e: Error) => toasts.error("Couldn't load the game settings", e.message));
  }, []);

  useEffect(() => setDownloading(status?.state === "downloading"), [status?.state]);

  async function save(next: Partial<ClipsSettings>) {
    setSaving(true);
    try {
      const result = await ClipsApi.setSettings(next);
      setSaved(result);
      setValue(result);
      toasts.success("Game settings saved");
    } catch (error) {
      toasts.error("Couldn't save", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function install() {
    try {
      await ClipsApi.installRecognition();
      setDownloading(true);
      recognition.reload();
    } catch (error) {
      toasts.error("Couldn't download picture recognition", (error as Error).message);
    }
  }

  async function remove() {
    try {
      await ClipsApi.removeRecognition();
      setRemoving(false);
      recognition.reload();
    } catch (error) {
      toasts.error("Couldn't remove picture recognition", (error as Error).message);
    }
  }

  async function runNow() {
    try {
      await ClipsApi.runRecognition();
      toasts.success("Looking at clips", "Suggestions show up on clips without a game. Tasks shows how far it is.");
    } catch (error) {
      toasts.error("Couldn't start", (error as Error).message);
    }
  }

  if (!value || !saved) return null;
  const keyChanged = (value.steamGridDbKey ?? "") !== (saved.steamGridDbKey ?? "");

  return (
    <>
      <section className="cn-settings__card" aria-labelledby="cn-games-heading">
        <h2 id="cn-games-heading">Games</h2>
        <p className="cn-settings__row-text"><span>Clips libraries sort clips into games by their file and folder names, and look the games up for their proper names, covers and artwork.</span></p>
        <Switch
          label="Look games up online"
          description="On Steam's store, which needs no key and knows most PC games."
          checked={value.lookups}
          disabled={saving}
          onChange={(lookups) => save({ lookups })}
        />
        <div className="cn-settings__row">
          <TextField
            label="SteamGridDB API key (optional)"
            description={<>Finds games that aren't on Steam, like VALORANT or League of Legends, and artwork Steam doesn't have. Get a free key from your <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noreferrer">SteamGridDB preferences</a>.</>}
            value={value.steamGridDbKey ?? ""}
            type="password"
            autoComplete="off"
            onChange={(e) => setValue({ ...value, steamGridDbKey: e.target.value || null })}
            style={{ flex: "1 1 20rem" }}
          />
          <Button variant="primary" onClick={() => save({ steamGridDbKey: value.steamGridDbKey })} loading={saving} disabled={!keyChanged}>Save key</Button>
        </div>
      </section>

      <section className="cn-settings__card" aria-labelledby="cn-recognition-heading">
        <h2 id="cn-recognition-heading">Picture recognition</h2>
        <p className="cn-settings__row-text">
          <span>
            For clips whose names don't say the game, like OBS recordings: Cinemion looks at a few frames of every clip and suggests a game when a clip looks
            like ones you've already given a game (or, as a best guess, like a game it knows). Suggestions are only taken when you say so. It runs on this
            server's processor, a clip at a time, and nothing leaves the server.
          </span>
        </p>
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>
              {!status ? "Checking…"
                : status.state === "ready" ? "Installed"
                : status.state === "downloading" ? `Downloading… ${formatPercent(status.progress ?? 0)}`
                : status.state === "failed" ? "The download didn't work"
                : "Not installed"}
            </strong>
            <span>
              {!status ? ""
                : status.state === "ready" ? status.pending ? `${status.pending.toLocaleString()} ${status.pending === 1 ? "clip hasn't" : "clips haven't"} been looked at yet.` : "Every clip has been looked at."
                : status.state === "failed" ? status.error
                : `A one-time download of ${formatBytes(status.downloadSize)}: an image model (CLIP) and what runs it.`}
            </span>
          </div>
          {status && (status.state === "missing" || status.state === "failed") && <Button variant="primary" icon={<Download />} onClick={install}>Download</Button>}
          {status?.state === "ready" && session.can("LIBRARY_MANAGE") && <Button icon={<ScanEye />} onClick={runNow}>Look at clips now</Button>}
          {status?.state === "ready" && <Button variant="ghost" icon={<Trash2 />} onClick={() => setRemoving(true)}>Remove</Button>}
        </div>
        {status?.state === "downloading" && (
          <div className="cn-settings__scan-bar" style={{ flex: "none", width: "100%" }}><span style={{ width: formatPercent(status.progress ?? 0) }} /></div>
        )}
        <Switch
          label="Suggest games after every scan"
          description="New clips without a game get a suggestion by themselves. Off, it only runs with “Look at clips now”."
          checked={value.autoSuggest}
          disabled={saving}
          onChange={(autoSuggest) => save({ autoSuggest })}
        />
      </section>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove picture recognition?"
        description="The download is deleted. Suggestions already made stay, and what it saw in clips is kept for when it's downloaded again."
        confirmLabel="Remove"
        danger
        onConfirm={remove}
      />
    </>
  );
}
