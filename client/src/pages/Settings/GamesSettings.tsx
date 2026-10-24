import { useEffect, useState } from "react";
import { Download, ScanEye, Trash2 } from "lucide-react";
import type { ClipsSettings } from "@shared/clips.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import { session } from "../../Session.ts";
import { usePoll } from "../../lib/usePoll.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatBytes, formatPercent } from "../../lib/format.ts";
import { rich, t } from "../../i18n/I18n.ts";
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
    }).catch((e: Error) => toasts.error(t("settings.games.couldntLoad"), e.message));
  }, []);

  useEffect(() => setDownloading(status?.state === "downloading"), [status?.state]);

  async function save(next: Partial<ClipsSettings>) {
    setSaving(true);
    try {
      const result = await ClipsApi.setSettings(next);
      setSaved(result);
      setValue(result);
      toasts.success(t("settings.games.saved"));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
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
      toasts.error(t("settings.games.recognition.couldntDownload"), (error as Error).message);
    }
  }

  async function remove() {
    try {
      await ClipsApi.removeRecognition();
      setRemoving(false);
      recognition.reload();
    } catch (error) {
      toasts.error(t("settings.games.recognition.couldntRemove"), (error as Error).message);
    }
  }

  async function runNow() {
    try {
      await ClipsApi.runRecognition();
      toasts.success(t("settings.games.recognition.started"), t("settings.games.recognition.startedDescription"));
    } catch (error) {
      toasts.error(t("settings.games.recognition.couldntStart"), (error as Error).message);
    }
  }

  if (!value || !saved) return null;
  const keyChanged = (value.steamGridDbKey ?? "") !== (saved.steamGridDbKey ?? "");

  return (
    <>
      <section className="cn-settings__card" aria-labelledby="cn-games-heading">
        <h2 id="cn-games-heading">{t("settings.games.title")}</h2>
        <p className="cn-settings__row-text"><span>{t("settings.games.intro")}</span></p>
        <Switch
          label={t("settings.games.lookups")}
          description={t("settings.games.lookupsDescription")}
          checked={value.lookups}
          disabled={saving}
          onChange={(lookups) => save({ lookups })}
        />
        <div className="cn-settings__row">
          <TextField
            label={t("settings.games.steamGridDbKey")}
            description={rich("settings.games.steamGridDbDescription", { link: (text) => <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noreferrer">{text}</a> })}
            value={value.steamGridDbKey ?? ""}
            type="password"
            autoComplete="off"
            onChange={(e) => setValue({ ...value, steamGridDbKey: e.target.value || null })}
            style={{ flex: "1 1 20rem" }}
          />
          <Button variant="primary" onClick={() => save({ steamGridDbKey: value.steamGridDbKey })} loading={saving} disabled={!keyChanged}>{t("settings.games.saveKey")}</Button>
        </div>
      </section>

      <section className="cn-settings__card" aria-labelledby="cn-recognition-heading">
        <h2 id="cn-recognition-heading">{t("settings.games.recognition.title")}</h2>
        <p className="cn-settings__row-text">
          <span>{t("settings.games.recognition.intro")}</span>
        </p>
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>
              {!status ? t("settings.games.recognition.checking")
                : status.state === "ready" ? t("settings.games.recognition.installed")
                : status.state === "downloading" ? t("settings.games.recognition.downloading", { percent: formatPercent(status.progress ?? 0) })
                : status.state === "failed" ? t("settings.games.recognition.failed")
                : t("settings.games.recognition.notInstalled")}
            </strong>
            <span>
              {!status ? ""
                : status.state === "ready" ? status.pending ? t("settings.games.recognition.pending", { count: status.pending }) : t("settings.games.recognition.allDone")
                : status.state === "failed" ? status.error
                : t("settings.games.recognition.downloadSize", { size: formatBytes(status.downloadSize) })}
            </span>
          </div>
          {status && (status.state === "missing" || status.state === "failed") && <Button variant="primary" icon={<Download />} onClick={install}>{t("common.download")}</Button>}
          {status?.state === "ready" && session.can("LIBRARY_MANAGE") && <Button icon={<ScanEye />} onClick={runNow}>{t("settings.games.recognition.runNow")}</Button>}
          {status?.state === "ready" && <Button variant="ghost" icon={<Trash2 />} onClick={() => setRemoving(true)}>{t("common.remove")}</Button>}
        </div>
        {status?.state === "downloading" && (
          <div className="cn-settings__scan-bar" style={{ flex: "none", width: "100%" }}><span style={{ width: formatPercent(status.progress ?? 0) }} /></div>
        )}
        <Switch
          label={t("settings.games.recognition.autoSuggest")}
          description={t("settings.games.recognition.autoSuggestDescription")}
          checked={value.autoSuggest}
          disabled={saving}
          onChange={(autoSuggest) => save({ autoSuggest })}
        />
      </section>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("settings.games.recognition.removeTitle")}
        description={t("settings.games.recognition.removeDescription")}
        confirmLabel={t("common.remove")}
        danger
        onConfirm={remove}
      />
    </>
  );
}
