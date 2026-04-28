readonly LEAN_CODEX_CONFIG_TOML_CONTENT=$'base_instructions = "Answer briefly and directly. Do not use tools."\ninclude_permissions_instructions = false\ninclude_apps_instructions = false\ninclude_environment_context = false\nmodel_reasoning_effort = "none"\nweb_search = "disabled"\npersonality = "pragmatic"\n\n[skills.bundled]\nenabled = false\n\n[memories]\nuse_memories = false\ngenerate_memories = false\n\n[features]\nplugins = false\napps = false\ntool_search = false\ntool_suggest = false\nmemories = false\nmulti_agent = false\npersonality = false\nshell_tool = false\n'
readonly LEAN_GEMINI_SETTINGS_JSON_CONTENT=$'{\n  "security": {\n    "auth": {\n      "selectedType": "oauth-personal"\n    }\n  },\n  "general": {\n    "defaultApprovalMode": "plan",\n    "sessionRetention": {\n      "enabled": false\n    }\n  },\n  "ui": {\n    "hideBanner": true,\n    "hideTips": true,\n    "hideContextSummary": true,\n    "hideFooter": true,\n    "loadingPhrases": "off",\n    "showShortcutsHint": false,\n    "showUserIdentity": false\n  },\n  "context": {\n    "fileName": "__QGEMINI_CONTEXT_DISABLED__.md",\n    "includeDirectoryTree": false,\n    "includeDirectories": [],\n    "loadMemoryFromIncludeDirectories": false,\n    "discoveryMaxDirs": 0\n  },\n  "skills": {\n    "enabled": false\n  }\n}\n'
readonly LEAN_GEMINI_SYSTEM_MD_CONTENT=$'Answer briefly and directly.\nIf the request can be answered from general knowledge, answer in one short response.\n'

write_file_if_needed() {
  local target_path="$1"
  local expected_content="$2"
  local current_content=""

  if [[ -f "$target_path" ]]; then
    current_content="$(<"$target_path")"
    if [[ "$current_content" == "$expected_content" ]]; then
      return 0
    fi
  fi

  mkdir -p "$(dirname "$target_path")"
  printf '%s' "$expected_content" > "$target_path"
}

link_or_copy_file() {
  local source_path="$1"
  local target_path="$2"

  if [[ ! -f "$source_path" ]]; then
    return 1
  fi

  mkdir -p "$(dirname "$target_path")"

  if [[ -L "$target_path" ]]; then
    if [[ "$(readlink "$target_path")" == "$source_path" ]]; then
      return 0
    fi
    rm -f "$target_path"
  elif [[ -f "$target_path" ]]; then
    return 0
  fi

  if ! ln -s "$source_path" "$target_path" 2>/dev/null; then
    cp "$source_path" "$target_path"
  fi
}

ensure_codex_min_home() {
  local codex_home="${CODEX_MIN_HOME:-$HOME/.codex-min}"
  local codex_source_home="${CODEX_SOURCE_HOME:-$HOME/.codex}"
  local codex_auth_path="$codex_source_home/auth.json"
  local codex_installation_id_path="$codex_source_home/installation_id"

  command -v codex >/dev/null 2>&1 || {
    print -u2 -- "codex executable not found on PATH"
    return 1
  }

  [[ -f "$codex_auth_path" ]] || {
    print -u2 -- "Codex auth not found at $codex_auth_path. Run codex login first."
    return 1
  }

  mkdir -p "$codex_home"
  write_file_if_needed "$codex_home/config.toml" "$LEAN_CODEX_CONFIG_TOML_CONTENT"
  link_or_copy_file "$codex_auth_path" "$codex_home/auth.json" || return 1

  if [[ -f "$codex_installation_id_path" ]]; then
    link_or_copy_file "$codex_installation_id_path" "$codex_home/installation_id" || return 1
  fi
}

ensure_gemini_min_home() {
  local gemini_home="${GEMINI_MIN_HOME:-$HOME/.gemini-min-home}"
  local gemini_source_home="${GEMINI_SOURCE_HOME:-$HOME/.gemini}"
  local gemini_config_dir="$gemini_home/.gemini"
  local gemini_oauth_path="$gemini_source_home/oauth_creds.json"
  local gemini_auth_files=(
    oauth_creds.json
    google_account_id
    google_accounts.json
    installation_id
    projects.json
    state.json
    user_id
  )
  local file_name=""

  command -v gemini >/dev/null 2>&1 || {
    print -u2 -- "gemini executable not found on PATH"
    return 1
  }

  [[ -f "$gemini_oauth_path" ]] || {
    print -u2 -- "Gemini auth not found at $gemini_oauth_path. Run gemini login first."
    return 1
  }

  mkdir -p "$gemini_config_dir"
  write_file_if_needed "$gemini_config_dir/settings.json" "$LEAN_GEMINI_SETTINGS_JSON_CONTENT"
  write_file_if_needed "$gemini_config_dir/system.md" "$LEAN_GEMINI_SYSTEM_MD_CONTENT"

  for file_name in "${gemini_auth_files[@]}"; do
    if [[ -f "$gemini_source_home/$file_name" ]]; then
      link_or_copy_file "$gemini_source_home/$file_name" "$gemini_config_dir/$file_name" || return 1
    fi
  done
}
