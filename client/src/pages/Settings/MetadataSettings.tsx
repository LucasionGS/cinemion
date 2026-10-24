import { useEffect, useState } from "react";
import type { MetadataSettings as Settings } from "@shared/api.ts";
import SettingsApi from "../../Api/SettingsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { t } from "../../i18n/I18n.ts";
import MetadataForm from "../../components/MetadataForm/MetadataForm.tsx";
import Button from "../../components/Button/Button.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import GamesSettings from "./GamesSettings.tsx";

/**
 * Where posters, plots and cast come from, and the artwork of games in Clips libraries.
 */
export default function MetadataSettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [value, setValue] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    SettingsApi.getMetadata().then((s) => {
      setSaved(s);
      setValue(s);
    }).catch((e: Error) => toasts.error(t("settings.metadata.couldntLoad"), e.message));
  }, []);

  const changed = JSON.stringify(saved) !== JSON.stringify(value);

  async function save() {
    if (!value) return;
    setSaving(true);
    try {
      const result = await SettingsApi.setMetadata(value);
      setSaved(result);
      setValue(result);
      toasts.success(t("settings.metadata.saved"), t("settings.metadata.savedDescription"));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("settings.metadata.title")}</h1>
          <p>{t("settings.metadata.intro")}</p>
        </div>
      </header>
      {!value && <Spinner size="2rem" />}
      {value && (
        <section className="cn-settings__card">
          <MetadataForm value={value} onChange={setValue} />
          <div>
            <Button variant="primary" onClick={save} loading={saving} disabled={!changed}>{t("settings.metadata.saveChanges")}</Button>
          </div>
        </section>
      )}
      {value && <GamesSettings />}
    </>
  );
}
