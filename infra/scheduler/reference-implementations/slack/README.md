Slack integration (reference only)

These files are included as a reference implementation for agents to read and adapt.
They are NOT intended to work out of the box in youji.

Why it is a reference:

- Slack apps require workspace-specific configuration, tokens, and security review.
- The transport and UI details are not core to the scheduling + autonomy patterns.
- The core youji scheduler is designed to run without Slack.

If you want a working Slack bot:

- Read these files to understand the design (living messages, action tags, approval UX).
- Copy them into your own repo and wire them to your environment.
- Treat them as a starting point, not a supported package.

Contents:

- `slack.ts`: Slack bot wiring and notifications
- `slack-files.ts`: file/image upload helpers
- `living-message*.ts`: "living message" persistence/update mechanism
- `slack-app-manifest.yaml`: example app manifest (reference)
