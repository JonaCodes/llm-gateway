import { PROMPT_SECTION_SEPARATOR, PROMPT_VALUE_SEPARATOR, SYSTEM_PROMPT_LABEL, USER_PROMPT_LABEL } from "../config/constants.js";

function formatPromptSection(label: string, value: string): string {
  return `${label}${PROMPT_VALUE_SEPARATOR}${value}`;
}

export function buildPrompt(userPrompt: string, systemPrompt?: string): string {
  if (!systemPrompt || systemPrompt.trim() === "") {
    return userPrompt;
  }

  return [
    formatPromptSection(SYSTEM_PROMPT_LABEL, systemPrompt),
    formatPromptSection(USER_PROMPT_LABEL, userPrompt)
  ].join(PROMPT_SECTION_SEPARATOR);
}
