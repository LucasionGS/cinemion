import { ArrowDown, ArrowUp } from "lucide-react";
import type { MetadataSettings } from "@shared/api.ts";
import IconButton from "../IconButton/IconButton.tsx";
import TextField from "../TextField/TextField.tsx";
import Select from "../Select/Select.tsx";
import "./MetadataForm.scss";

const PROVIDERS: Record<string, { name: string; description: string }> = {
  local: { name: "Your files", description: "NFO files and artwork next to your videos" },
  tmdb: { name: "TMDB", description: "Online database for movies and shows" },
  tvdb: { name: "TheTVDB", description: "Online database for shows, strong on anime and episode orders" },
};

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "nl", label: "Dutch" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "sv", label: "Swedish" },
  { value: "da", label: "Danish" },
  { value: "no", label: "Norwegian" },
  { value: "ja", label: "Japanese" },
];

export const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "NL", label: "Netherlands" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "ES", label: "Spain" },
  { value: "IT", label: "Italy" },
  { value: "SE", label: "Sweden" },
  { value: "DK", label: "Denmark" },
  { value: "NO", label: "Norway" },
  { value: "JP", label: "Japan" },
];

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

  function moveProvider(index: number, by: number) {
    const providers = [...value.providers];
    const [moved] = providers.splice(index, 1);
    providers.splice(index + by, 0, moved);
    onChange({ ...value, providers });
  }

  return (
    <div className="cn-metadata-form">
      <ol className="cn-metadata-form__providers" aria-label="Metadata sources, in priority order">
        {value.providers.map((id, i) => (
          <li key={id} className="cn-metadata-form__provider">
            <div className="cn-metadata-form__provider-row">
              <span className="cn-metadata-form__rank">{i + 1}</span>
              <div className="cn-metadata-form__provider-text">
                <strong>{PROVIDERS[id]?.name ?? id}</strong>
                <span>{PROVIDERS[id]?.description}</span>
              </div>
              <IconButton label={`Move ${PROVIDERS[id]?.name} up`} icon={<ArrowUp />} size="sm" variant="ghost" disabled={i === 0} onClick={() => moveProvider(i, -1)} />
              <IconButton label={`Move ${PROVIDERS[id]?.name} down`} icon={<ArrowDown />} size="sm" variant="ghost" disabled={i === value.providers.length - 1} onClick={() => moveProvider(i, 1)} />
            </div>
            {id === "tmdb" && (
              <TextField
                label="API key"
                className="cn-metadata-form__field"
                placeholder="Paste your TMDB API key or read access token"
                autoComplete="off"
                value={value.tmdbApiKey ?? ""}
                onChange={(e) => onChange({ ...value, tmdbApiKey: e.target.value })}
                description={<>Free with a TMDB account. <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">How to get one</a></>}
              />
            )}
            {id === "tvdb" && (
              <div className="cn-metadata-form__keys">
                <TextField
                  label="API key"
                  className="cn-metadata-form__field"
                  placeholder="Paste your TheTVDB project API key"
                  autoComplete="off"
                  value={value.tvdbApiKey ?? ""}
                  onChange={(e) => onChange({ ...value, tvdbApiKey: e.target.value })}
                  description={<>From a TheTVDB account. <a href="https://thetvdb.com/api-information" target="_blank" rel="noreferrer">How to get one</a></>}
                />
                <TextField
                  label="Subscriber PIN (optional)"
                  className="cn-metadata-form__field"
                  autoComplete="off"
                  value={value.tvdbPin ?? ""}
                  onChange={(e) => onChange({ ...value, tvdbPin: e.target.value })}
                  description="Only for keys that come with a TheTVDB subscription."
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      <TextField
        label="OMDb API key, for ratings (optional)"
        placeholder="Paste your OMDb API key"
        autoComplete="off"
        value={value.omdbApiKey ?? ""}
        onChange={(e) => onChange({ ...value, omdbApiKey: e.target.value })}
        description={<>Adds IMDb, Rotten Tomatoes and Metacritic scores to movies and shows that have an IMDb id. Free keys allow 1000 lookups a day. <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">How to get one</a></>}
      />
      <div className="cn-metadata-form__row">
        <Select label="Language" value={value.language} options={LANGUAGES} onChange={(e) => onChange({ ...value, language: e.target.value })} />
        <Select label="Country (for age ratings)" value={value.country} options={COUNTRIES} onChange={(e) => onChange({ ...value, country: e.target.value })} />
      </div>
    </div>
  );
}
