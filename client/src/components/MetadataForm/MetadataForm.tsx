import { ArrowDown, ArrowUp } from "lucide-react";
import type { MetadataSettings } from "@shared/api.ts";
import IconButton from "../IconButton/IconButton.tsx";
import TextField from "../TextField/TextField.tsx";
import Select from "../Select/Select.tsx";
import { session } from "../../Session.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import TmdbCredit from "../TmdbCredit/TmdbCredit.tsx";
import "./MetadataForm.scss";

/**
 * Each source's name and what it is. Online services go by their own `brand` name.
 */
const PROVIDERS: Record<string, { name?: TranslationKey; brand?: string; description: TranslationKey }> = {
  local: { name: "metadataForm.providers.local", description: "metadataForm.providers.localDescription" },
  tmdb: { brand: "TMDB", description: "metadataForm.providers.tmdbDescription" },
  tvdb: { brand: "TheTVDB", description: "metadataForm.providers.tvdbDescription" },
};

const LANGUAGES: { value: string; label: TranslationKey }[] = [
  { value: "en", label: "metadataForm.languages.en" },
  { value: "nl", label: "metadataForm.languages.nl" },
  { value: "de", label: "metadataForm.languages.de" },
  { value: "fr", label: "metadataForm.languages.fr" },
  { value: "es", label: "metadataForm.languages.es" },
  { value: "it", label: "metadataForm.languages.it" },
  { value: "pt", label: "metadataForm.languages.pt" },
  { value: "sv", label: "metadataForm.languages.sv" },
  { value: "da", label: "metadataForm.languages.da" },
  { value: "no", label: "metadataForm.languages.no" },
  { value: "ja", label: "metadataForm.languages.ja" },
];

export const COUNTRIES: { value: string; label: TranslationKey }[] = [
  { value: "US", label: "metadataForm.countries.us" },
  { value: "GB", label: "metadataForm.countries.gb" },
  { value: "NL", label: "metadataForm.countries.nl" },
  { value: "DE", label: "metadataForm.countries.de" },
  { value: "FR", label: "metadataForm.countries.fr" },
  { value: "ES", label: "metadataForm.countries.es" },
  { value: "IT", label: "metadataForm.countries.it" },
  { value: "SE", label: "metadataForm.countries.se" },
  { value: "DK", label: "metadataForm.countries.dk" },
  { value: "NO", label: "metadataForm.countries.no" },
  { value: "JP", label: "metadataForm.countries.jp" },
];

/**
 * A source's name to show, or its id when Cinemion doesn't know it.
 */
function providerName(id: string) {
  const provider = PROVIDERS[id];
  if (!provider) return id;
  return provider.name ? t(provider.name) : provider.brand ?? id;
}

/**
 * A "How to get one" link to where a service hands out keys.
 */
function keyLink(href: string) {
  return (text: string) => <a href={href} target="_blank" rel="noreferrer">{text}</a>;
}

export interface MetadataFormProps {
  value: MetadataSettings;
  onChange: (value: MetadataSettings) => void;
}

/**
 * Metadata sources in priority order with their keys, the OMDb key for ratings, and language and country. Used by
 * setup and settings.
 */
export default function MetadataForm(props: MetadataFormProps) {
  const { value, onChange } = props;
  const builtIn = session.server?.hasBuiltInTmdbKey ?? false;

  function moveProvider(index: number, by: number) {
    const providers = [...value.providers];
    const [moved] = providers.splice(index, 1);
    providers.splice(index + by, 0, moved);
    onChange({ ...value, providers });
  }

  return (
    <div className="cn-metadata-form">
      <ol className="cn-metadata-form__providers" aria-label={t("metadataForm.sources")}>
        {value.providers.map((id, i) => (
          <li key={id} className="cn-metadata-form__provider">
            <div className="cn-metadata-form__provider-row">
              <span className="cn-metadata-form__rank">{i + 1}</span>
              <div className="cn-metadata-form__provider-text">
                <strong>{providerName(id)}</strong>
                <span>{PROVIDERS[id] && t(PROVIDERS[id].description)}</span>
              </div>
              <IconButton label={t("metadataForm.moveUp", { name: providerName(id) })} icon={<ArrowUp />} size="sm" variant="ghost" disabled={i === 0} onClick={() => moveProvider(i, -1)} />
              <IconButton label={t("metadataForm.moveDown", { name: providerName(id) })} icon={<ArrowDown />} size="sm" variant="ghost" disabled={i === value.providers.length - 1} onClick={() => moveProvider(i, 1)} />
            </div>
            {id === "tmdb" && (
              <TextField
                label={builtIn ? t("metadataForm.tmdb.ownKey") : t("metadataForm.tmdb.apiKey")}
                className="cn-metadata-form__field"
                placeholder={builtIn ? t("metadataForm.tmdb.builtInPlaceholder") : t("metadataForm.tmdb.placeholder")}
                autoComplete="off"
                value={value.tmdbApiKey ?? ""}
                onChange={(e) => onChange({ ...value, tmdbApiKey: e.target.value })}
                description={builtIn
                  ? rich("metadataForm.tmdb.builtInDescription", { link: keyLink("https://www.themoviedb.org/settings/api") })
                  : rich("metadataForm.tmdb.description", { link: keyLink("https://www.themoviedb.org/settings/api") })}
              />
            )}
            {id === "tmdb" && <div className="cn-metadata-form__field"><TmdbCredit compact /></div>}
            {id === "tvdb" && (
              <div className="cn-metadata-form__keys">
                <TextField
                  label={t("metadataForm.tvdb.apiKey")}
                  className="cn-metadata-form__field"
                  placeholder={t("metadataForm.tvdb.placeholder")}
                  autoComplete="off"
                  value={value.tvdbApiKey ?? ""}
                  onChange={(e) => onChange({ ...value, tvdbApiKey: e.target.value })}
                  description={rich("metadataForm.tvdb.description", { link: keyLink("https://thetvdb.com/api-information") })}
                />
                <TextField
                  label={t("metadataForm.tvdb.pin")}
                  className="cn-metadata-form__field"
                  autoComplete="off"
                  value={value.tvdbPin ?? ""}
                  onChange={(e) => onChange({ ...value, tvdbPin: e.target.value })}
                  description={t("metadataForm.tvdb.pinDescription")}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      <TextField
        label={t("metadataForm.omdb.label")}
        placeholder={t("metadataForm.omdb.placeholder")}
        autoComplete="off"
        value={value.omdbApiKey ?? ""}
        onChange={(e) => onChange({ ...value, omdbApiKey: e.target.value })}
        description={rich("metadataForm.omdb.description", { link: keyLink("https://www.omdbapi.com/apikey.aspx") })}
      />
      <div className="cn-metadata-form__row">
        <Select label={t("metadataForm.language")} value={value.language} options={LANGUAGES.map((l) => ({ value: l.value, label: t(l.label) }))} onChange={(e) => onChange({ ...value, language: e.target.value })} />
        <Select label={t("metadataForm.country")} value={value.country} options={COUNTRIES.map((c) => ({ value: c.value, label: t(c.label) }))} onChange={(e) => onChange({ ...value, country: e.target.value })} />
      </div>
    </div>
  );
}
