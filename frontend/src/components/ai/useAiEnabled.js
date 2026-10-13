import { useSiteConfig } from "../../context/SiteConfigContext.jsx";

/**
 * Is the assistant running on this deployment?
 *
 * Strict `=== true`, deliberately unlike `useFeature`, which treats an absent
 * key as enabled. That default is right for features that ship on and can be
 * switched off; this one ships OFF, so "I have not heard from the server yet"
 * and "this server is too old to have an opinion" both have to read as off.
 * Getting it the other way round would flash a launcher on every first paint
 * for a feature that is not there.
 *
 * The server forces this false whenever AI_ENABLED is unset, whatever the
 * admin setting says, so this one answer covers both switches.
 */
export function useAiEnabled() {
  return useSiteConfig().ai_chat_enabled === true;
}
