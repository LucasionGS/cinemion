import { useEffect, useState } from "react";
import type { MetadataSettings as Settings } from "@shared/api.ts";
import SettingsApi from "../../Api/SettingsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import MetadataForm from "../../components/MetadataForm/MetadataForm.tsx";
import Button from "../../components/Button/Button.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";

/**
 * Where posters, plots and cast come from.
 */
export default function MetadataSettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [value, setValue] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    SettingsApi.getMetadata().then((s) => {
      setSaved(s);
      setValue(s);
    }).catch((e: Error) => toasts.error("Couldn't load metadata settings", e.message));
  }, []);

  const changed = JSON.stringify(saved) !== JSON.stringify(value);

  async function save() {
    if (!value) return;
    setSaving(true);
    try {
      const result = await SettingsApi.setMetadata(value);
      setSaved(result);
      setValue(result);
      toasts.success("Metadata settings saved", "Use \"Refresh all details\" on a library to apply them to what's already there.");
    } catch (error) {
      toasts.error("Couldn't save", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Metadata</h1>
          <p>Where posters, plots and cast come from. Sources higher in the list win when they disagree.</p>
        </div>
      </header>
      {!value && <Spinner size="2rem" />}
      {value && (
        <section className="cn-settings__card">
          <MetadataForm value={value} onChange={setValue} />
          <div>
            <Button variant="primary" onClick={save} loading={saving} disabled={!changed}>Save changes</Button>
          </div>
        </section>
      )}
    </>
  );
}
