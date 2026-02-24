# Dialogue Colors

A SillyTavern extension that makes the LLM color-code each character's dialogue automatically. Instantly see who's speaking at a glance with LLM-driven character detection, colorblind-friendly palettes, and optional CSS effects for dramatic text.

---

## Features

### Core
- **Auto-coloring** - Instructs the LLM to wrap dialogue in `<font color>` tags
- **LLM color blocks** - LLM outputs `[COLORS:Name=#RRGGBB,...]` at end of messages for reliable character detection (auto-removed)
- **Auto-detect nicknames/usernames** - LLM can include nicknames in parentheses: `[COLORS:Alice(xX_Alice_Xx)=#FF0000]` - these are automatically added as character aliases
- **Per-chat or global colors** - Store colors per character or share across all chats
- **Auto-lock detected characters** - Automatically lock newly detected characters (default: on)
- **Right-click/long-press** - Tap and hold (mobile) or right-click (desktop) on colored dialogue to assign it to a character (default: off)

### Color Management
- **Color lock** 🔒 - Lock a character's color to prevent changes
- **Quick swap** ⇄ - Click two characters to swap their colors
- **Avatar color extraction** - Auto-suggest colors from character avatar's dominant color
- **Brightness adjustment** - Global slider for lighter/darker colors
- **Theme flip** ☀/🌙 - Instantly flip all colors between dark↔light suited variants
- **Undo/Redo** ↶↷ - Full history with Ctrl+Z/Y shortcuts
- **Export/Import** - Save and load color schemes as JSON
- **Export as PNG** - Generate a theme-aware visual legend image (dark/light background)
- **Color presets** - Save, load, and delete presets via dropdown UI
- **Recolor messages** - Rewrite all existing message colors to match current assignments after changing a character's color
- **Auto-recolor** - Automatically recolor + reload chat when colors change via picker, harmony popup, regen, or theme flip (default: on)
- **Auto-brightness** - Automatically recolor messages when the brightness slider changes (default: off)
- **Smart color suggestions** - Auto-suggests colors based on character names (e.g., "Rose" → pink)
- **Color harmony** - Double-click a color input to see complementary, triadic, and analogous suggestions
- **Custom palettes** - Generate palettes from words (optionally LLM-enhanced) or save your current character colors

### Palettes
- Pastel, Neon, Earth, Jewel, Muted, Jade, Forest, Ocean, Sunset, Aurora, Warm, Cool, Berry, Monochrome
- **Colorblind-friendly:** Protanopia, Deuteranopia, Tritanopia
- **Custom palettes** - Generate from words or save snapshots alongside the built-in ones

### Word-Based Custom Palettes
Click **Gen** next to the Palette dropdown, enter a palette name, and add optional notes. If LLM enhancement is enabled, the result is refined by the LLM; if it fails, the extension automatically falls back to the local generator.

Example prompts:
- Psychedelic
- Noir rain city
- Soft cottagecore sunrise

### CSS Effects
*Inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)*

When enabled, instructs the LLM to apply CSS transforms for dramatic effect:
- **Chaos/madness** → `rotate(2deg) skew(5deg)`
- **Magic** → `scale(1.2)`
- **Unease** → `skew(-10deg)`
- **Rage** → `uppercase`
- **Whispers** → `lowercase`

Effects are visible in chat but stripped from the prompt context.

### Advanced
- **Character aliases** - Map multiple names to same color, shown as removable chips
- **Per-character styles** - Bold, italic, or both
- **Character grouping** - Assign characters to groups, sort by group with visual headers
- **Batch operations** - Multi-select characters with checkboxes for bulk lock/unlock/delete/style
- **Narrator color** - Separate color for narration (included in color block)
- **Thought symbols** - Custom symbols (e.g., `*`, `『』`) for inner thoughts
- **Highlight mode** - Background highlights + text color
- **Card integration** - Save/load colors to character card metadata
- **Conflict resolution** - Auto-fix similar colors with detailed feedback on which pairs were fixed

### Visual
- **Floating legend** - Toggle overlay showing character→color mapping
- **Dialogue statistics** - Bar graph of who's talking most
- **Dialogue count badges** - ⭐ (50+), 💎 (100+) for frequent speakers
- **Collapsible UI sections** - Settings organized into Display, Behavior, Actions, and Characters sections
- **Mobile-optimized** - Larger touch targets and responsive layout on small screens

## Installation

1. Open SillyTavern → Extensions → Install Extension
2. Paste: `https://github.com/platberlitz/sillytavern-character-colors`
3. Click Install

## Quick Start

1. Enable the extension (checkbox at the top)
2. Start chatting - the LLM will color dialogue and output a `[COLORS:...]` block
3. Characters are detected automatically from the color block and locked by default
4. Enable right-click context menu if you want to manually assign colors
5. Right-click or long-press colored text to manually assign colors (when enabled)

### How It Works

1. Extension injects a prompt telling LLM to use `<font color>` tags
2. LLM outputs `[COLORS:Name=#RRGGBB,...]` at the end of each response
3. Extension parses the block, extracts characters/colors, and removes it from display
4. Regex scripts strip font tags and color blocks from the prompt context
5. Colors persist per chat or globally (configurable)

## UI Reference

### Display Section
| Control | Function |
|---------|----------|
| **Enable** | Toggle extension on/off |
| **Highlight mode** | Add background highlights to dialogue |
| **Show floating legend** | Overlay showing character colors |
| **CSS effects** | Enable emotion/magic CSS transforms |
| **Theme** | Auto/Dark/Light mode |
| **Palette** | Choose from 17 built-in + custom palettes |
| **Gen** (Palette) | Generate a custom palette from words (name + optional notes) |
| **+/−** (Palette) | Save current colors as custom palette / Delete custom palette |
| **Brightness** | Adjust all colors lighter/darker |
| **Auto-brightness** | Automatically recolor messages on brightness change (default: off) |

### Behavior Section
| Control | Function |
|---------|----------|
| **Auto-scan on chat load** | Scan for characters when opening a chat |
| **Auto-scan new messages** | Scan each new generated message for colors |
| **Auto-lock detected characters** | Automatically lock newly detected characters |
| **Auto-recolor on change** | Recolor + reload chat when colors change (default: on) |
| **Enable right-click context menu** | Enable right-click/long-press color assignment |
| **Disable narration** | Exclude narrator from coloring |
| **Share colors globally** | Use same colors across all chats |
| **Enhance generated palettes with LLM** | Optional LLM refinement with automatic local fallback |
| **Narrator** | Set narrator color |
| **Thoughts** | Symbols for inner thoughts |

### Actions Section
| Control | Function |
|---------|----------|
| **Scan** | Scan messages for color blocks |
| **Clear** | Remove all characters |
| **Stats** | Show dialogue statistics |
| **Recolor** | Rewrite font colors in all messages to match current color assignments |
| **Fix** | Auto-resolve color conflicts (reports which pairs were fixed) |
| **Regen** | Regenerate all colors |
| **☀/🌙** | Flip colors for dark↔light theme switch |
| **Preset Save/Load/Del** | Manage color presets via dropdown |
| **Export/Import** | Backup colors as JSON |
| **PNG** | Export legend as image (theme-aware background) |
| **+Card** | Add current character |
| **Avatar** | Extract color from avatar |
| **Save→Card** | Save to character card |
| **Card→Load** | Load from character card |
| **🔒All/🔓All** | Lock/unlock all characters |
| **Reset** | Reset unlocked colors |
| **DelLocked** | Delete all locked characters |
| **DelUnlocked** | Delete all unlocked characters |
| **DelLeast** | Delete characters below dialogue threshold |
| **DelDupes** | Delete duplicate colors, keep highest dialogue count |

### Characters Section
| Control | Function |
|---------|----------|
| **Search** | Filter characters by name |
| **Sort** | Sort by Name, Dialogue Count, or Group |
| **Batch bar** | Appears when characters are selected: Select All, Deselect All, Delete, Lock, Unlock, Style |
| **☐** (checkbox) | Select character for batch operations |
| **🔒** | Lock/unlock character color |
| **⇄** | Swap colors between characters |
| **S** | Cycle text style |
| **+** | Add alias |
| **G** | Assign character to a group |
| **×** | Delete character |
| **Double-click color** | Show color harmony suggestions (complementary, triadic, analogous) |
| **× on alias chip** | Remove an alias |

## Auto-Imported Regex Scripts

The extension automatically imports these regex scripts:

1. **Trim Font Colors** - Removes `<font>` tags from prompt
2. **Trim Color Blocks** - Removes `[COLORS:...]` from prompt (display cleanup is handled by the extension runtime)
3. **Trim CSS Effects (Prompt)** - Strips CSS transform spans from prompt only (keeps display)

## Credits

- CSS effects feature inspired by [Prolix's Lucid Loom](https://github.com/prolix-oc/ST-Presets)

## License

MIT
