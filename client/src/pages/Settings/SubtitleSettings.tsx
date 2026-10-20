import { useEffect, useState } from "react";
import type { SubtitleSettings as Settings } from "@shared/playback.ts";
import { LANGUAGES } from "@shared/languages.ts";
import SubtitlesApi from "../../Api/SubtitlesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
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
    }).catch((e: Error) => toasts.error("Couldn't load subtitle settings", e.message));
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
      toasts.success("Subtitle settings saved");
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
          <h1>Subtitles</h1>
          <p>Search subtitles online from the player, or let Cinemion fetch them for new movies and episodes. Subtitle files next to your videos are picked up by themselves.</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!changed || value.languages.length === 0}>Save changes</Button>
      </header>

      <section className="cn-settings__card">
        <h2>Automatic downloads</h2>
        <Switch
          label="Download subtitles by themselves"
          description="Movies and episodes without subtitles in one of your languages get the best ones the sites have, preferring ones made for the exact file. What isn't found is looked for again after a day, three days, a week, and so on."
          checked={value.autoDownload}
          onChange={(autoDownload) => update({ autoDownload })}
        />
        {value.autoDownload && !anySite && <p className="cn-settings__row-text"><span>Turn on at least one subtitle site below for this to find anything.</span></p>}
      </section>

      <section className="cn-settings__card">
        <h2>Subtitle sites</h2>
        <h3 className="cn-settings__subheading">OpenSubtitles</h3>
        <p className="cn-settings__row-text">
          <span>
            Create a free account on <a href="https://www.opensubtitles.com" target="_blank" rel="noreferrer">opensubtitles.com</a>, then add an API consumer under your profile's API settings and paste its key here. Signing in is optional; it raises the number of downloads per day.
          </span>
        </p>
        <TextField label="API key" value={value.openSubtitlesApiKey ?? ""} onChange={(e) => update({ openSubtitlesApiKey: e.target.value })} autoComplete="off" spellCheck={false} />
        <div className="cn-playback__fields">
          <TextField label="Username" description="Optional" value={value.openSubtitlesUsername ?? ""} onChange={(e) => update({ openSubtitlesUsername: e.target.value })} autoComplete="off" />
          <TextField
            label="Password"
            type="password"
            description={value.hasOpenSubtitlesPassword ? "Saved. Type a new one to change it." : "Optional"}
            placeholder={value.hasOpenSubtitlesPassword ? "••••••••" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="cn-settings__divider" />
        <h3 className="cn-settings__subheading">SubDL</h3>
        <p className="cn-settings__row-text">
          <span>A free site with a big catalogue. Make an account on <a href="https://subdl.com" target="_blank" rel="noreferrer">subdl.com</a> and copy the API key from your account page.</span>
        </p>
        <TextField label="API key" value={value.subdlApiKey ?? ""} onChange={(e) => update({ subdlApiKey: e.target.value })} autoComplete="off" spellCheck={false} />
        <div className="cn-settings__divider" />
        <Switch
          label="Podnapisi"
          description="Search podnapisi.net too. It needs no account; its subtitles are found by title, so their timing may be a little off."
          checked={value.podnapisiEnabled}
          onChange={(podnapisiEnabled) => update({ podnapisiEnabled })}
        />
      </section>

      <section className="cn-settings__card">
        <h2>Languages</h2>
        <p className="cn-settings__row-text"><span>Offered first when searching, and the ones downloaded by themselves.</span></p>
        <div className="cn-playback__chips">
          {LANGUAGES.map((l) => {
            const on = value.languages.includes(l.code);
            return (
              <button key={l.code} type="button" aria-pressed={on} className={cx("cn-playback__chip", on && "cn-playback__chip--on")} onClick={() => toggleLanguage(l.code)}>
                {l.name}
              </button>
            );
          })}
        </div>
        <div className="cn-settings__divider" />
        <Switch
          label="Save next to the video file"
          description="Off, or when the media folder is read-only (as in Docker with :ro), downloads are kept in the config folder instead."
          checked={value.saveNextToVideo}
          onChange={(saveNextToVideo) => update({ saveNextToVideo })}
        />
      </section>
    </>
  );
}
