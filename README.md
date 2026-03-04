# Fachwerk

## Stop hunting through hidden directories for your Claude Code agents and skills.

Claude Code buries your agents in `~/.claude/agents/`, your skills in `~/.claude/skills/`, and your instructions in `~/.claude/CLAUDE.md`. Every time you need to edit one, you leave your editor, navigate to a hidden folder, and break your flow. You do this dozens of times a week if you are serious about your setup.

Fachwerk puts all of it in your VS Code sidebar. One click to open any file. One click to create a new agent or skill. Always visible, every project, no navigation required.

```
ext install gundurraga.fachwerk
```

## What you get

**Four sidebar panels, always one click away:**

1. **Agents** -- every agent in `~/.claude/agents/`, displayed with its folder structure
2. **Skills** -- every skill in `~/.claude/skills/`, same treatment
3. **CLAUDE.md** -- your global `~/.claude/CLAUDE.md` and every project-level CLAUDE.md in your workspace, in one list
4. **Custom Folders** -- any folder on your machine, pinned to the sidebar as its own section (up to 10)

Click a file to open it. The sidebar watches your filesystem and refreshes automatically when anything changes. You never press a refresh button. You never re-navigate.

## Create agents and skills without leaving the editor

Click the **+** button on the Agents or Skills panel. Type a name. Fachwerk creates the directory structure, writes a starter template with frontmatter, and opens the file for editing. The template for an agent looks like this:

```yaml
---
name: your-agent-name
description: Describe what this agent does
tools:
  - Read
  - Glob
  - Grep
---

# Instructions

Write your agent instructions here.
```

You are editing within seconds. No `mkdir`, no `touch`, no remembering the correct directory path.

## Pin any folder to your sidebar

Prompt libraries. Shared templates. Documentation you reference constantly. Add any folder three ways:

- Click **Add Folder** at the bottom of the Fachwerk panel
- Run **"Add to Fachwerk"** from the Command Palette
- Edit `fachwerk.folders` directly in your VS Code settings (an array of absolute paths)

Each folder appears as its own collapsible section with its full directory tree. Remove it from the three-dot menu on the panel header. Folders are stored globally -- they persist across every workspace you open.

## Right-click to manage files

Right-click any file in the sidebar:

- **Copy Content** -- copies the full file contents to your clipboard (works on all panels)
- **Rename** -- rename agents and skills in place
- **Delete** -- delete agents and skills with a confirmation prompt

## Teach Claude Code about Fachwerk

Add this to your CLAUDE.md:

```markdown
## Fachwerk

The VS Code extension "Fachwerk" shows custom folders in the sidebar.
To add or remove folders, update the `fachwerk.folders` array in VS Code's
global settings (settings.json). Each entry is an absolute path.
```

Now when you tell Claude "add tmp/ to Fachwerk," it knows exactly what to do. Your AI manages its own sidebar.

## Why the name

Fachwerk is the German word for timber framing -- the exposed structure that holds a building together. Your agents, skills, and instructions are the structure that holds your AI workflow together. This extension makes that structure visible.

## License

MIT
