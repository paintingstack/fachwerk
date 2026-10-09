# Fachwerk

Keep the folders you choose within reach in your VS Code sidebar, across every workspace.

Pin shared notes, documentation, templates, or any folder you use often. Each folder gets its own collapsible section. Click a file to open it, browse subfolders, and see changes automatically.

Install **Fachwerk** by **gundurraga** from the VS Code Marketplace.

## Choose your folders

Open Fachwerk in the Activity Bar and click **Add Folders**. Select one or several folders, including hidden folders, to pin them. You can also right click a folder in Explorer and choose **Add Folders**.

Use **Manage Folders** to see all pinned folders and saved file sections, including sections preserved during an upgrade. Uncheck any you no longer want. Saved sections remain in the list, so you can check them again to restore them. Each section also has **Remove from Sidebar** in its header menu. Removing a pin leaves the folder and its files intact.

Fachwerk supports up to 10 pinned folders. Pins are saved globally, so they follow you between workspaces. Workspace settings can override them.

To manage paths directly, edit `fachwerk.folders` in VS Code settings. Each entry is an absolute folder path.

## Work with files

Files inside pinned folders offer copy, rename, and Move to Trash. Saved file collections offer opening and copying, so their references stay intact. Linked folders can be browsed, and linked files open at their real location. Hidden files and folders are included. An unavailable folder shows a message instead of appearing empty.

## Upgrading

Existing folder pins stay in place. Earlier Agents, Skills, and Instructions panels become ordinary saved sections, retaining their view identifiers and contents. Fachwerk no longer creates Claude directories or agent and skill templates.

Marketplace upgrades and existing folder settings trigger this conversion automatically. If a manual installation has no saved settings and no upgrade metadata, Fachwerk asks once whether to **Keep Previous Sidebar** or **Add Folders**.

Saved sections live in `fachwerk.sections`. Each has a name and either an absolute folder path or a list of file paths. File sections can also find files relative to each workspace, keeping project instructions available when you switch projects. Hide any saved section from its header menu without deleting files, then restore it through **Manage Folders**.

## Development

Run `npm run lint` for JavaScript syntax checks and `npm test` for migration and sidebar tests. Run `npm run test:host` to check the migration and pin commands in an isolated VS Code window. Press F5 to open an Extension Development Host.

## License

MIT
