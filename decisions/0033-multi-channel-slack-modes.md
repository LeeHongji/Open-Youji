# 0033: Multi-Channel Slack Modes (Dev + Chat)

Date: 2026-02-23
Status: accepted (chat suggestion routing updated by ADR 0048)

## Context

Youji's Slack bot operated in a single-user DM model: one designated user (`SLACK_USER_ID`) with full access to all capabilities. As Youji matures and begins collaborative work with human teams, it needs to be present in Slack channels where multiple users interact with it in different contexts.

Design tension: **Autonomy vs Safety**. The current single-user model gives full trust to one user. Multi-user channels introduce users with heterogeneous trust levels. Enabling collaborative access (more humans can interact) conflicts with maintaining safety (not all users should be able to approve, launch experiments, or modify the repository).

Secondary tension: **Simplicity vs Capability**. A single message handler is simple but can't differentiate between interaction contexts.

## Decision

Introduce two channel interaction modes, configurable through Slack interactions (not environment variables):

### Dev mode
- Full research bot access, identical to the existing DM capabilities
- Any user in the channel can interact with all features: experiments, approvals, deep work, jobs, skills, burst mode

### Chat mode
- Conversational Q&A only — no repository modifications
- Users can ask questions, discuss research, share insights
- Youji can read files to answer accurately but cannot use Edit, Write, Bash, or other mutating tools
- Two safe actions are permitted:
  - `[ACTION:suggest_task]` — records a suggested task to `chat-suggestions.md` in the project directory
  - `[ACTION:note_question]` — records an open question to the same file
- All other action tags (experiments, approvals, deep work, jobs, burst) are blocked at the code level

### Configuration via Slack

Channel modes are configured through Slack interactions, not environment variables:

1. **Slash command**: `/youji mode <dev|chat>` — run in any channel where the bot is present to set that channel's mode. Only the designated user (`SLACK_USER_ID`) or Slack workspace admins can change modes.
2. **App Home**: The Youji Slack app's Home tab displays all configured channels with their current modes. The designated user can add, remove, or change channel modes from this view.
3. **Persistent storage**: Channel mode configuration is stored in `infra/slack-bot/channel-modes.json` (committed to the repo). This makes configuration visible, auditable, and version-controlled. The file is read at startup and updated in-place when modes change via Slack.
4. **Fallback**: If a channel is not in the config file and the bot is invited to it, the bot ignores messages until a mode is set via `/youji mode`.

This approach eliminates the need to edit `.env` and restart the bot when adding or removing channels — configuration changes take effect immediately.

### DM access
- Only the designated user (`SLACK_USER_ID`) receives DM access (unchanged)
- DMs always operate in dev mode

### Implementation

New module: `channel-mode.ts` — channel mode registry with lookup, set, and persistence functions. Reads `channel-modes.json` at startup; writes back on updates.

New Slack integration:
- Slash command handler (`/youji mode`) — validates permissions, updates registry, persists to file, responds with confirmation.
- App Home tab — renders current channel mode configuration using Block Kit. Includes buttons to change or remove modes.

Modified modules:
- `slack.ts` — message handler checks channel context (DM vs channel, registered vs unregistered) and routes accordingly. Added `app_mention` handler for channel @mentions. Unregistered channels are silently ignored. Registers the `/youji` slash command and App Home event handler.
- `chat.ts` — `processMessage` accepts `channelMode` parameter. In chat mode: skips burst/deep-work/skill detection, uses restricted prompt, blocks mutable action tags, disallows write tools.
- `chat-prompt.ts` — new `buildChatModePrompt()` for chat-mode channels with restricted capabilities.
- `action-tags.ts` — new `suggest_task` and `note_question` action tags, plus `isChatModeAction()` filter.

Safety enforcement is multi-layered:
1. **Prompt level**: chat-mode prompt explicitly states restrictions
2. **Tool level**: `disallowedTools` blocks Edit, Write, NotebookEdit, Bash
3. **Action level**: `isChatModeAction()` rejects non-chat-mode action tags in the response handler
4. **Code level**: burst/deep-work/skill detection bypassed entirely in chat mode
5. **Permission level**: only the designated user or workspace admins can change channel modes

## Consequences

- Youji can now be added to team Slack channels with appropriate access levels.
- Chat-mode channels allow casual interaction and knowledge sharing without risk of unintended repository modifications.
- Dev-mode channels extend the full DM experience to team collaboration.
- Chat suggestions are recorded in `chat-suggestions.md` rather than directly modifying `TASKS.md`, maintaining human curation of the task list.
- The `app_mention` handler enables @mention-based interaction in channels (standard Slack bot pattern).
- Channel modes are managed entirely from Slack — no `.env` edits or bot restarts needed to add/remove channels. Changes take effect immediately.
- Configuration is version-controlled in `channel-modes.json`, making it auditable and recoverable.
- The Slack app requires additional scopes (`commands` for slash commands, `app_mentions:read`) and a registered slash command (`/youji`).
- The App Home tab gives the designated user a dashboard view of all configured channels.
- If a channel somehow has conflicting modes (e.g., set via concurrent requests), the last write wins. The JSON file is the single source of truth.

## Migration

1. Register the `/youji` slash command in the Slack app configuration (api.slack.com) pointing to the bot's request URL
2. Add required Slack app scopes: `commands`, `app_mentions:read`, `channels:history`, `users:read`
3. Enable the App Home tab in the Slack app configuration and subscribe to the `app_home_opened` event
4. Deploy the updated bot code (includes `channel-mode.ts`, slash command handler, App Home handler)
5. Create an empty `infra/slack-bot/channel-modes.json` (`{"channels": {}}`) — or let the bot create it on first `/youji mode` invocation
6. Invite the bot to desired channels, then run `/youji mode dev` or `/youji mode chat` in each channel to configure its mode
7. No changes needed for existing DM-only usage — the system defaults to DM-only mode when no channels are configured
