Chat mode (reference only)

These files implement an interactive chat-mode controller (originally backed by Slack).

Youji includes them as a reference implementation for agents to read and adapt.
They are NOT intended to work out of the box.

Core scheduler operation does not require chat mode.

Files:

- `chat.ts`: chat state machine + action handlers
- `chat-context.ts`: conversation context/persistence helpers
- `chat-prompt.ts`: prompt template for interactive control
- `thread-turns.ts`: helpers for extracting thread turns
