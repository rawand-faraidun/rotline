# Rotline

The full project brief is in `docs/BRIEF.md`. Read all of it before doing anything else.
The brand pack is in `/brand`; read `/brand/README.md` before building any interface.

- `docs/` describes the project itself (architecture, netcode, data model, game design, interface), written in general terms, not tied to a specific host or provider.
- `planning/` is local and git-ignored: research, decisions, open questions, milestones, infrastructure plans. Read it for context; never commit it.
- Server provisioning (Ansible, production Compose files) lives outside this repository, in a folder the owner chooses.
- This repository is set up for Claude Code only: no `AGENTS.md`, `.agents/` or copies for other tools.
