# Fachwerk

Your Claude Code agents and skills in the VS Code sidebar. Always visible, any project.

## The Problem

Claude Code stores agents in `~/.claude/agents/` and skills in `~/.claude/skills/`. These directories are hidden, out of sight, and easy to forget. When you're iterating on agents, navigating there breaks your flow.

## The Solution

Fachwerk adds a sidebar panel that shows your agents and skills. Click to open. Right-click to rename, copy, or delete. Create new ones with the + button. No navigation required.

## Installation

Search "Fachwerk" in the VS Code marketplace, or:

```
ext install gundurraga.fachwerk
```

## Usage

After installation, click the Fachwerk icon in the activity bar. You'll see two panels:

- **Agents** - Your Claude Code agents
- **Skills** - Your Claude Code skills

Click any file to open it. The sidebar auto-refreshes when files change.

### Creating Agents and Skills

Click the + button in the panel header. Enter a name. Fachwerk creates the folder structure and opens the file with a starter template.

### Context Menu

Right-click any item for:

- **Copy Content** - Copy file contents to clipboard
- **Rename** - Rename the file or folder
- **Delete** - Delete with confirmation

## Why "Fachwerk"

Fachwerk is the German word for timber framing. The exposed wooden structure that holds a building together. Your agents and skills are the structure that holds your AI workflow together.

## License

MIT
