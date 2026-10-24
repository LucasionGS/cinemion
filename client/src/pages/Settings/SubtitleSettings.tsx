import { useEffect, useState } from "react";
import type { SubtitleSettings as Settings } from "@shared/playback.ts";
import { LANGUAGES } from "@shared/languages.ts";
import SubtitlesApi from "../../Api/SubtitlesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import { displayLanguage } from "../../lib/playback.ts";
import { rich, t } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";

/**
 * Which subtitle sites are searched, which languages are wanted (and downloaded by themselves), and where downloads go.
 */
export default function SubtitleSettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [value, setValue] = useState<Settings | null>(null);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    SubtitlesApi.getSettings().then((s) => {
      setSaved(s);
      setValue(s);
    }).catch((e: Error) => toasts.error(t("settings.subtitles.couldntLoad"), e.message));
  }, []);

  if (!value) return <Spinner size="2rem" />;
  const changed = JSON.stringify(saved) !== JSON.stringify(value) || password !== "";
  const anySite = !!value.openSubtitlesApiKey || !!value.subdlApiKey || value.podnapisiEnabled;
  const update = (patch: Partial<Settings>) => setValue({ ...value, ...patch });

  function toggleLanguage(code: string) {
    const on = value!.languages.includes(code);
    update({ languages: on ? value!.languages.filter((l) => l !== code) : [...value!.languages, code] });
  }

  async function save() {
    setSaving(true);
    try {
      const result = await SubtitlesApi.setSettings({ ...value!, openSubtitlesPassword: password || undefined });
      setSaved(result);
      setValue(result);
      setPassword("");
      toasts.success(t("settings.subtitles.saved"));
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
          <h1>{t("settings.subtitles.title")}</h1>
          <p>{t("settings.subtitles.intro")}</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!changed || value.languages.length === 0}>{t("settings.subtitles.saveChanges")}</Button>
      </header>

      <section className="cn-settings__card">
        <h2>{t("settings.subtitles.automatic")}</h2>
        <Switch
          label={t("settings.subtitles.autoDownload")}
          description={t("settings.subtitles.autoDownloadDescription")}
          checked={value.autoDownload}
          onChange={(autoDownload) => update({ autoDownload })}
        />
        {value.autoDownload && !anySite && <p className="cn-settings__row-text"><span>{t("settings.subtitles.noSite")}</span></p>}
      </section>

      <section className="cn-settings__card">
        <h2>{t("settings.subtitles.sites")}</h2>
        <h3 className="cn-settings__subheading">OpenSubtitles</h3>
        <p className="cn-settings__row-text">
          <span>
            {rich("settings.subtitles.openSubtitlesHelp", { link: (text) => <a href="https://www.opensubtitles.com" target="_blank" rel="noreferrer">{text}</a> })}
          </span>
        </p>
        <TextField label={t("settings.subtitles.apiKey")} value={value.openSubtitlesApiKey ?? ""} onChange={(e) => update({ openSubtitlesApiKey: e.target.value })} autoComplete="off" spellCheck={false} />
        <div className="cn-playback__fields">
          <TextField label={t("settings.subtitles.username")} description={t("settings.subtitles.optional")} value={value.openSubtitlesUsername ?? ""} onChange={(e) => update({ openSubtitlesUsername: e.target.value })} autoComplete="off" />
          <TextField
            label={t("settings.subtitles.password")}
            type="password"
            description={value.hasOpenSubtitlesPassword ? t("settings.subtitles.passwordSaved") : t("settings.subtitles.optional")}
            placeholder={value.hasOpenSubtitlesPassword ? "••••••••" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="cn-settings__divider" />
        <h3 className="cn-settings__subheading">SubDL</h3>
        <p className="cn-settings__row-text">
          <span>{rich("settings.subtitles.subdlHelp", { link: (text) => <a href="https://subdl.com" target="_blank" rel="noreferrer">{text}</a> })}</span>
        </p>
        <TextField label={t("settings.subtitles.apiKey")} value={value.subdlApiKey ?? ""} onChange={(e) => update({ subdlApiKey: e.target.value })} autoComplete="off" spellCheck={false} />
        <div className="cn-settings__divider" />
        <Switch
          label="Podnapisi"
          description={t("settings.subtitles.podnapisiDescription")}
          checked={value.podnapisiEnabled}
          onChange={(podnapisiEnabled) => update({ podnapisiEnabled })}
        />
      </section>

      <section className="cn-settings__card">
        <h2>{t("settings.subtitles.languages")}</h2>
        <p className="cn-settings__row-text"><span>{t("settings.subtitles.languagesDescription")}</span></p>
        <div className="cn-playback__chips">
          {LANGUAGES.map((l) => {
            const on = value.languages.includes(l.code);
            return (
              <button key={l.code} type="button" aria-pressed={on} className={cx("cn-playback__chip", on && "cn-playback__chip--on")} onClick={() => toggleLanguage(l.code)}>
                {displayLanguage(l.code) ?? l.name}
              </button>
            );
          })}
        </div>
        <div className="cn-settings__divider" />
        <Switch
          label={t("settings.subtitles.saveNextToVideo")}
          description={t("settings.subtitles.saveNextToVideoDescription")}
          checked={value.saveNextToVideo}
          onChange={(saveNextToVideo) => update({ saveNextToVideo })}
        />
      </section>
    </>
  );
}
