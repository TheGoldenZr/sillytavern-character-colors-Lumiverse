(async function () {
    'use strict';

    const { extension_settings, saveSettingsDebounced, getContext } = await import('../../../extensions.js');
    const { eventSource, event_types, setExtensionPrompt, saveCharacterDebounced, getCharacters, extension_prompt_types, extension_prompt_roles, generateQuietPrompt } = await import('../../../../script.js');

    // Cache frequently used DOM queries
    const domCache = new Map();
    function getCachedElement(selector) {
        if (!domCache.has(selector)) {
            domCache.set(selector, document.querySelector(selector));
        }
        return domCache.get(selector);
    }
    function clearDomCache() { domCache.clear(); }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escapeAttr(s) {
        return escapeHtml(s);
    }

    function normalizeHexColor(value, fallback = '#888888') {
        const color = String(value ?? '').trim();
        return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
    }

    const VALID_STYLES = new Set(['', 'bold', 'italic', 'bold italic']);

    function normalizeAliases(aliases) {
        if (!Array.isArray(aliases)) return [];
        return [...new Set(aliases.map(a => String(a ?? '').trim()).filter(Boolean))];
    }

    function normalizeCharacterEntry(entry, fallbackName = '') {
        const name = String(entry?.name ?? fallbackName ?? '').trim();
        if (!name) return null;
        const color = normalizeHexColor(entry?.color);
        const baseColor = normalizeHexColor(entry?.baseColor, color);
        return {
            color,
            baseColor,
            name,
            locked: !!entry?.locked,
            aliases: normalizeAliases(entry?.aliases),
            style: VALID_STYLES.has(entry?.style) ? entry.style : '',
            dialogueCount: Number.isFinite(entry?.dialogueCount) && entry.dialogueCount > 0 ? Math.floor(entry.dialogueCount) : 0,
            group: String(entry?.group ?? '').trim()
        };
    }

    function normalizeCharacterColors(rawColors) {
        if (!rawColors || typeof rawColors !== 'object') return {};
        const normalized = {};
        for (const [rawKey, entry] of Object.entries(rawColors)) {
            const normalizedEntry = normalizeCharacterEntry(entry, rawKey);
            if (!normalizedEntry) continue;
            const key = normalizedEntry.name.toLowerCase();
            if (!normalized[key]) {
                normalized[key] = normalizedEntry;
                continue;
            }
            const existing = normalized[key];
            existing.locked = existing.locked || normalizedEntry.locked;
            existing.aliases = [...new Set([...existing.aliases, ...normalizedEntry.aliases])];
            existing.dialogueCount = Math.max(existing.dialogueCount || 0, normalizedEntry.dialogueCount || 0);
            if (!existing.group && normalizedEntry.group) existing.group = normalizedEntry.group;
            if (!existing.style && normalizedEntry.style) existing.style = normalizedEntry.style;
            if (existing.baseColor === '#888888' && normalizedEntry.baseColor !== '#888888') existing.baseColor = normalizedEntry.baseColor;
            if (existing.color === '#888888' && normalizedEntry.color !== '#888888') existing.color = normalizedEntry.color;
        }
        return normalized;
    }

    // Optimized color distance calculation
    function colorDistance(color1, color2) {
        const [h1, , l1] = hexToHsl(color1);
        const [h2, , l2] = hexToHsl(color2);
        const hDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
        return hDiff < 25 && Math.abs(l1 - l2) < 15;
    }

    const MODULE_NAME = 'dialogue-colors';
    const COLOR_SCHEMA_VERSION = 2;
    let characterColors = {};
    let colorHistory = [];
    let historyIndex = -1;
    let swapMode = null;
    let sortMode = 'name';
    let searchTerm = '';
    let settings = { enabled: true, themeMode: 'auto', narratorColor: '', colorTheme: 'pastel', brightness: 0, highlightMode: false, autoScanOnLoad: true, showLegend: false, thoughtSymbols: '*', disableNarration: true, shareColorsGlobally: false, cssEffects: false, autoScanNewMessages: true, autoLockDetected: true, enableRightClick: false, llmEnhanceCustomPalettes: true, promptDepth: 4, showControlHelp: true, autoRecolor: true, autoBrightness: false, colorSchemaVersion: COLOR_SCHEMA_VERSION };
    let lastCharKey = null;
    let lastProcessedMessageSignature = '';
    // Phase 6A: Batch selection state
    let selectedKeys = new Set();
    // Phase 3A: Legend event listener cleanup
    let legendListeners = null;
    let autoRecolorHintShown = false;
    let isRecoloring = false;

    const CONTROL_HELP_TEXT = Object.freeze({
        'dc-enabled': 'Enable or disable Dialogue Colors prompt injection and color formatting.',
        'dc-highlight': 'Add background highlighting behind colored dialogue text.',
        'dc-legend': 'Show a draggable floating legend of active character colors.',
        'dc-css-effects': 'Allow transform-based CSS effects for intense dialogue moments.',
        'dc-theme': 'Choose Auto, Dark, or Light targeting for generated color readability.',
        'dc-palette': 'Pick the color palette used for new or regenerated character colors.',
        'dc-gen-palette': 'Generate a custom palette from prompt words.',
        'dc-save-palette': 'Save current colors as a reusable custom palette.',
        'dc-del-palette': 'Delete the currently selected custom palette.',
        'dc-palette-name-input': 'Name used for inline custom palette create/save actions.',
        'dc-palette-notes-input': 'Optional notes that guide generated palette style.',
        'dc-overwrite-existing': 'Allow replacing an existing custom palette with the same name.',
        'dc-palette-save-inline': 'Save current active colors to the named custom palette.',
        'dc-palette-generate-inline': 'Generate a custom palette from the name and notes fields.',
        'dc-brightness': 'Shift generated color lightness up or down.',
        'dc-autoscan': 'Automatically scan existing chat messages after chat load.',
        'dc-autoscan-new': 'Automatically scan newly arriving messages for speakers/colors.',
        'dc-auto-lock': 'Automatically lock newly detected characters to preserve assignments.',
        'dc-right-click': 'Enable right-click or long-press assign-color menu on messages.',
        'dc-disable-narration': 'Skip narrator color assignment in generated prompt instructions.',
        'dc-share-global': 'Use one shared color table for all chats instead of per-chat storage.',
        'dc-llm-palette': 'Use LLM assistance to refine generated custom palettes.',
        'dc-narrator': 'Set narrator fallback color used when narration coloring is enabled.',
        'dc-narrator-clear': 'Clear custom narrator color and return to default.',
        'dc-thought-symbols': 'Symbols used to detect and color inner-thought dialogue.',
        'dc-thought-add': 'Append another thought symbol to the list.',
        'dc-thought-clear': 'Remove all thought symbols.',
        'dc-prompt-depth': 'How far from the chat end the system color prompt is injected.',
        'dc-help-toggle': 'Show or hide the inline help panel explaining each control.',
        'dc-scan': 'Scan chat messages and infer character colors from dialogue.',
        'dc-clear': 'Remove all tracked characters and color assignments.',
        'dc-stats': 'Open dialogue statistics for currently tracked characters.',
        'dc-recolor': 'Rewrite font colors in all messages to match current color assignments.',
        'dc-auto-recolor': 'Automatically recolor and reload chat when character colors change.',
        'dc-auto-brightness': 'Automatically recolor messages when the brightness slider changes.',
        'dc-undo': 'Undo the last color-table change.',
        'dc-redo': 'Redo the most recently undone change.',
        'dc-fix-conflicts': 'Auto-resolve colors that are too similar.',
        'dc-regen': 'Regenerate colors for unlocked characters using current settings.',
        'dc-flip-theme': 'Invert color lightness to quickly adapt to light/dark theme changes.',
        'dc-preset-name': 'Preset name used when saving current color assignments.',
        'dc-save-preset': 'Save current assignments into a named preset.',
        'dc-preset-select': 'Select a preset to load into or remove from this chat.',
        'dc-load-preset': 'Load selected preset colors into current character list.',
        'dc-delete-preset': 'Delete the selected preset from local storage.',
        'dc-export': 'Export colors and settings to a JSON file.',
        'dc-import': 'Import colors and settings from a JSON file.',
        'dc-export-png': 'Export the floating legend as an image.',
        'dc-card': 'Add current card character to the color list if missing.',
        'dc-avatar-color': 'Extract a suggested color from the current character avatar.',
        'dc-save-card': 'Save this chat color data into character card extensions.',
        'dc-load-card': 'Load saved color data from character card extensions.',
        'dc-lock-all': 'Lock every tracked character color.',
        'dc-unlock-all': 'Unlock every tracked character color.',
        'dc-reset': 'Reassign colors for all unlocked characters.',
        'dc-del-locked': 'Delete all locked characters.',
        'dc-del-unlocked': 'Delete all unlocked characters.',
        'dc-del-least': 'Delete characters below a dialogue-count threshold.',
        'dc-del-least-threshold': 'Minimum dialogue count to keep when using DelLeast.',
        'dc-del-dupes': 'Delete duplicate-color characters, keeping highest dialogue count.',
        'dc-search': 'Filter characters by name, alias, or group.',
        'dc-sort': 'Sort character list by name, dialogue count, or group.',
        'dc-add-name': 'Type a new character name to add manually.',
        'dc-add-btn': 'Add typed character with a suggested color.',
        'dc-batch-all': 'Select all characters for batch operations.',
        'dc-batch-none': 'Clear all current character selections.',
        'dc-batch-del': 'Delete selected characters.',
        'dc-batch-lock': 'Lock selected characters.',
        'dc-batch-unlock': 'Unlock selected characters.',
        'dc-batch-style-select': 'Style to apply to selected characters.',
        'dc-batch-style-apply': 'Apply the selected style to all selected characters.'
    });

    const DYNAMIC_CONTROL_HELP_TEXT = Object.freeze({
        '.dc-batch-check': 'Select this character row for batch actions.',
        '.dc-color-dot': 'Click to open the color picker for this character.',
        '.dc-color-input': 'Pick a color directly. Double-click for harmony suggestions.',
        '.dc-lock': 'Toggle lock for this character color.',
        '.dc-swap': 'Choose two characters in sequence to swap their colors.',
        '.dc-style': 'Cycle style: none, bold, italic, then bold italic.',
        '.dc-alias': 'Add an alternate name that maps to this character.',
        '.dc-group': 'Assign this character to a group label.',
        '.dc-del': 'Delete this character from the list.',
        '.dc-alias-remove': 'Remove this alias from the character.'
    });

    const CONTROL_HELP_PANEL_GROUPS = Object.freeze([
        {
            title: 'Display',
            items: [
                { label: 'Enable', key: 'dc-enabled' },
                { label: 'Highlight mode', key: 'dc-highlight' },
                { label: 'Floating legend', key: 'dc-legend' },
                { label: 'CSS effects', key: 'dc-css-effects' },
                { label: 'Theme', key: 'dc-theme' },
                { label: 'Palette', key: 'dc-palette' },
                { label: 'Gen / + / -', key: 'dc-gen-palette' },
                { label: 'Palette editor', key: 'dc-palette-name-input' },
                { label: 'Overwrite palette', key: 'dc-overwrite-existing' },
                { label: 'Brightness', key: 'dc-brightness' },
                { label: 'Auto-brightness', key: 'dc-auto-brightness' }
            ]
        },
        {
            title: 'Behavior',
            items: [
                { label: 'Auto-scan on load', key: 'dc-autoscan' },
                { label: 'Auto-scan new', key: 'dc-autoscan-new' },
                { label: 'Auto-lock', key: 'dc-auto-lock' },
                { label: 'Right-click menu', key: 'dc-right-click' },
                { label: 'Disable narration', key: 'dc-disable-narration' },
                { label: 'Share global', key: 'dc-share-global' },
                { label: 'LLM palette', key: 'dc-llm-palette' },
                { label: 'Narr / Think / Depth', key: 'dc-narrator' }
            ]
        },
        {
            title: 'Actions',
            items: [
                { label: 'Scan / Clear / Stats', key: 'dc-scan' },
                { label: 'Recolor messages', key: 'dc-recolor' },
                { label: 'Auto-recolor', key: 'dc-auto-recolor' },
                { label: 'Undo / Redo / Fix', key: 'dc-undo' },
                { label: 'Regen / Theme flip', key: 'dc-regen' },
                { label: 'Presets', key: 'dc-save-preset' },
                { label: 'Import / Export / PNG', key: 'dc-export' },
                { label: 'Card tools', key: 'dc-card' },
                { label: 'Lock / Unlock / Reset', key: 'dc-lock-all' },
                { label: 'Delete tools', key: 'dc-del-locked' },
                { label: 'Delete threshold', key: 'dc-del-least-threshold' }
            ]
        },
        {
            title: 'Characters',
            items: [
                { label: 'Search / Sort', key: 'dc-search' },
                { label: 'Add (+)', key: 'dc-add-btn' },
                { label: 'Batch controls', key: 'dc-batch-all' },
                { label: 'Batch style', key: 'dc-batch-style-select' }
            ]
        },
        {
            title: 'Character Row',
            items: [
                { label: 'Checkbox', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-batch-check'] },
                { label: 'Color dot/picker', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-color-input'] },
                { label: 'Lock', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-lock'] },
                { label: 'Swap', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-swap'] },
                { label: 'Style', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-style'] },
                { label: 'Alias (+)', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-alias'] },
                { label: 'Group (G)', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-group'] },
                { label: 'Delete (x)', text: DYNAMIC_CONTROL_HELP_TEXT['.dc-del'] }
            ]
        }
    ]);

    const COLOR_THEMES = {
        pastel: [[340, 70, 75], [200, 70, 75], [120, 50, 70], [45, 80, 70], [280, 60, 75], [170, 60, 70], [20, 80, 75], [240, 60, 75]],
        neon: [[320, 100, 60], [180, 100, 50], [90, 100, 50], [45, 100, 55], [270, 100, 60], [150, 100, 45], [0, 100, 60], [210, 100, 55]],
        earth: [[25, 50, 55], [45, 40, 50], [90, 30, 45], [150, 35, 45], [180, 30, 50], [30, 60, 60], [60, 35, 55], [120, 25, 50]],
        jewel: [[340, 70, 45], [200, 80, 40], [150, 70, 40], [45, 80, 50], [280, 70, 45], [170, 70, 40], [0, 75, 50], [220, 75, 45]],
        muted: [[350, 30, 60], [200, 30, 55], [120, 25, 55], [45, 35, 60], [280, 25, 55], [170, 30, 55], [20, 35, 60], [240, 25, 55]],
        jade: [[170, 60, 55], [150, 55, 50], [160, 65, 45], [165, 50, 60], [155, 70, 40], [140, 45, 55], [175, 55, 50], [130, 60, 45]],
        forest: [[120, 50, 50], [90, 45, 45], [100, 55, 40], [110, 40, 55], [80, 50, 35], [130, 45, 50], [95, 60, 45], [85, 55, 40]],
        ocean: [[200, 70, 60], [190, 65, 55], [180, 60, 65], [210, 55, 60], [170, 75, 50], [220, 50, 65], [195, 80, 45], [205, 60, 70]],
        sunset: [[15, 85, 60], [35, 90, 55], [25, 80, 65], [40, 75, 70], [30, 95, 50], [20, 70, 75], [45, 85, 55], [10, 80, 60]],
        aurora: [[280, 50, 70], [300, 55, 65], [260, 45, 75], [290, 60, 60], [270, 65, 55], [310, 40, 80], [285, 70, 50], [275, 55, 70]],
        warm: [[20, 70, 65], [35, 75, 60], [45, 65, 70], [30, 80, 55], [40, 85, 50], [25, 90, 60], [50, 60, 75], [15, 75, 65]],
        cool: [[210, 60, 70], [240, 55, 65], [200, 65, 75], [225, 70, 60], [190, 75, 55], [250, 50, 80], [215, 80, 50], [235, 60, 75]],
        berry: [[330, 70, 60], [350, 65, 55], [320, 60, 70], [340, 75, 50], [360, 80, 45], [310, 55, 75], [345, 85, 40], [325, 70, 65]],
        monochrome: [[0, 0, 30], [0, 0, 40], [0, 0, 50], [0, 0, 60], [0, 0, 70], [0, 0, 80], [0, 0, 90], [0, 0, 20]],
        protanopia: [[45, 80, 60], [200, 80, 55], [270, 60, 65], [30, 90, 55], [180, 70, 50], [300, 50, 60], [60, 70, 55], [220, 70, 60]],
        deuteranopia: [[45, 80, 60], [220, 80, 55], [280, 60, 65], [30, 90, 55], [200, 70, 50], [320, 50, 60], [60, 70, 55], [240, 70, 60]],
        tritanopia: [[0, 70, 60], [180, 70, 55], [330, 60, 65], [20, 80, 55], [200, 60, 50], [350, 50, 60], [160, 70, 55], [10, 70, 60]]
    };
    let cachedTheme = null;
    let cachedThemeBackground = null;
    let cachedIsDark = null;
    let injectDebouncedTimer = null;

    function hslToHex(h, s, l) {
        l = Math.max(0, Math.min(100, l));
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function hexToHsl(hex) {
        if (!hex || typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return [0, 0, 50];
        let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) { h = s = 0; } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
        }
        return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    }

    function saveHistory() {
        colorHistory = colorHistory.slice(0, historyIndex + 1);
        colorHistory.push(JSON.stringify(characterColors));
        if (colorHistory.length > 20) colorHistory.shift();
        historyIndex = colorHistory.length - 1;
    }

    function undo() {
        if (historyIndex > 0) { historyIndex--; characterColors = JSON.parse(colorHistory[historyIndex]); saveData(); updateCharList(); injectPrompt(); }
    }

    function redo() {
        if (historyIndex < colorHistory.length - 1) { historyIndex++; characterColors = JSON.parse(colorHistory[historyIndex]); saveData(); updateCharList(); injectPrompt(); }
    }

    function showUndoToast(message) {
        if (!toastr?.info) return;
        toastr.info(`${message} Click this toast to undo.`, 'Undo Available', {
            closeButton: true,
            tapToDismiss: false,
            timeOut: 7000,
            extendedTimeOut: 3000,
            onclick: () => undo()
        });
    }

    function getInlinePaletteInputs() {
        const name = document.getElementById('dc-palette-name-input')?.value?.trim() || '';
        const notes = document.getElementById('dc-palette-notes-input')?.value || '';
        return { name, notes };
    }

    function shouldOverwritePalette() {
        return !!document.getElementById('dc-overwrite-existing')?.checked;
    }

    // Phase 5C: Handle custom palettes in getNextColor
    function getNextColor() {
        if (settings.colorTheme?.startsWith('custom:')) {
            const paletteName = settings.colorTheme.slice(7);
            const customs = getCustomPalettes();
            const palette = customs[paletteName];
            if (palette) {
                const usedColors = Object.values(characterColors).map(c => getBaseColor(c));
                for (const color of palette) {
                    const normalizedColor = normalizeHexColor(color);
                    if (!usedColors.includes(normalizedColor)) return normalizedColor;
                }
                const base = palette[Math.floor(Math.random() * palette.length)];
                const [h, s, l] = hexToHsl(base);
                return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, l);
            }
        }
        const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel;
        const usedColors = Object.values(characterColors).map(c => getBaseColor(c));
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const isDark = mode === 'dark';
        cachedIsDark = isDark;
        for (const [h, s, l] of theme) {
            const adjustedL = isDark ? Math.min(l + 15, 85) : Math.max(l - 15, 35);
            const color = hslToHex(h, s, adjustedL);
            if (!usedColors.includes(color)) return color;
        }
        const [h, s, l] = theme[Math.floor(Math.random() * theme.length)];
        return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, isDark ? 75 : 40);
    }

    // Phase 3B: Optimized conflict check with pre-computed HSL and early-out
    function checkColorConflicts() {
        const colors = Object.entries(characterColors);
        if (colors.length > 50) return [];
        const conflicts = [];
        const hslCache = colors.map(([, v]) => ({ name: v.name, hsl: hexToHsl(getEntryEffectiveColor(v)) }));
        for (let i = 0; i < hslCache.length - 1; i++) {
            for (let j = i + 1; j < hslCache.length; j++) {
                const [h1, , l1] = hslCache[i].hsl;
                const [h2, , l2] = hslCache[j].hsl;
                const hDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
                if (hDiff < 25 && Math.abs(l1 - l2) < 15) {
                    conflicts.push([hslCache[i].name, hslCache[j].name]);
                }
            }
        }
        return conflicts;
    }

    // Pre-compiled color name mapping for faster lookups
    const COLOR_NAME_MAP = new Map([
        ['red', 0], ['rose', 340], ['pink', 340], ['magenta', 330],
        ['purple', 280], ['violet', 270], ['blue', 220], ['cyan', 180],
        ['teal', 170], ['green', 120], ['lime', 90], ['yellow', 50],
        ['gold', 45], ['orange', 30], ['brown', 25], ['grey', 0], ['gray', 0]
    ]);

    function suggestColorForName(name) {
        const n = name.toLowerCase();
        for (const [colorName, hue] of COLOR_NAME_MAP) {
            if (n.includes(colorName)) return hslToHex(hue, 70, 50);
        }
        return null;
    }

    function regenerateAllColors() {
        invalidateThemeCache();
        const sortedEntries = Object.entries(characterColors)
            .sort((a, b) => (a[1].dialogueCount || 0) - (b[1].dialogueCount || 0));

        for (const [, char] of sortedEntries) {
            if (!char.locked) {
                setEntryFromBaseColor(char, suggestColorForName(char.name) || getNextColor());
            }
        }
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.('Colors regenerated');
        if (settings.autoRecolor) recolorAllMessages();
    }

    // Phase 4B: Improved conflict resolution feedback listing pairs
    function autoResolveConflicts() {
        const conflicts = checkColorConflicts();
        if (!conflicts.length) { toastr?.info?.('No conflicts found'); return; }
        const fixedPairs = [];
        conflicts.forEach(([name1, name2]) => {
            const key1 = name1.toLowerCase(), key2 = name2.toLowerCase();
            if (characterColors[key1] && !characterColors[key1].locked) {
                setEntryFromBaseColor(characterColors[key1], getNextColor());
                fixedPairs.push(`${name1} & ${name2} (changed ${name1})`);
            } else if (characterColors[key2] && !characterColors[key2].locked) {
                setEntryFromBaseColor(characterColors[key2], getNextColor());
                fixedPairs.push(`${name1} & ${name2} (changed ${name2})`);
            }
        });
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.(`Fixed: ${fixedPairs.join('; ')}`);
    }

    function flipColorsForTheme() {
        const entries = Object.entries(characterColors);
        if (!entries.length) { toastr?.info?.('No characters to flip'); return; }
        for (const [, char] of entries) {
            const [h, s, l] = hexToHsl(getEntryEffectiveColor(char));
            const newL = 100 - l;
            const clampedL = Math.max(25, Math.min(85, newL));
            setEntryFromEffectiveColor(char, hslToHex(h, s, clampedL));
        }
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.('Colors flipped for theme switch');
        if (settings.autoRecolor) recolorAllMessages();
    }

    // Phase 5A: Preset management with dropdown UI
    function saveColorPreset() {
        const nameInput = document.getElementById('dc-preset-name');
        const name = nameInput?.value?.trim();
        if (!name) { toastr?.warning?.('Enter a preset name'); return; }
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        presets[name] = Object.entries(characterColors).map(([, v]) => ({
            name: String(v.name ?? '').trim(),
            color: getEntryEffectiveColor(v),
            baseColor: getBaseColor(v),
            style: VALID_STYLES.has(v.style) ? v.style : '',
            aliases: normalizeAliases(v.aliases),
            group: String(v.group ?? '').trim(),
            locked: !!v.locked
        }));
        localStorage.setItem('dc_presets', JSON.stringify(presets));
        nameInput.value = '';
        refreshPresetDropdown();
        toastr?.success?.(`Preset "${name}" saved`);
    }

    function loadColorPreset() {
        const select = document.getElementById('dc-preset-select');
        const name = select?.value;
        if (!name) { toastr?.warning?.('Select a preset first'); return; }
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        if (!presets[name]) { toastr?.error?.('Preset not found'); return; }
        const presetData = presets[name];
        if (!Array.isArray(presetData)) { toastr?.error?.('Preset is invalid'); return; }
        let changed = false;
        for (const p of presetData) {
            const normalized = normalizeCharacterEntry(p, p?.name);
            if (!normalized) continue;
            const key = normalized.name.toLowerCase();
            const existing = characterColors[key];
            characterColors[key] = {
                ...normalized,
                dialogueCount: existing?.dialogueCount || 0
            };
            changed = true;
        }
        if (changed) saveHistory();
        saveData(); updateCharList(); injectPrompt();
        toastr?.success?.(`Preset "${name}" loaded`);
    }

    function deleteColorPreset() {
        const select = document.getElementById('dc-preset-select');
        const name = select?.value;
        if (!name) { toastr?.warning?.('Select a preset first'); return; }
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        delete presets[name];
        localStorage.setItem('dc_presets', JSON.stringify(presets));
        refreshPresetDropdown();
        toastr?.success?.(`Preset "${name}" deleted`);
    }

    function refreshPresetDropdown() {
        const select = document.getElementById('dc-preset-select');
        if (!select) return;
        let presets = {};
        try { presets = JSON.parse(localStorage.getItem('dc_presets') || '{}') || {}; } catch { }
        const names = Object.keys(presets);
        select.innerHTML = '<option value="">-- Select Preset --</option>' + names.map(n => {
            const safeName = escapeAttr(n);
            return `<option value="${safeName}">${safeName}</option>`;
        }).join('');
    }

    // Phase 5C: Custom palettes
    const CUSTOM_PALETTE_KEY = 'dc_custom_palettes';
    const CUSTOM_PALETTE_META_KEY = 'dc_custom_palette_meta';
    const CUSTOM_PALETTE_SIZE = 8;

    const PALETTE_STOPWORDS = new Set([
        'the', 'a', 'an', 'and', 'or', 'of', 'to', 'with', 'for', 'in', 'on', 'at', 'from', 'by',
        'style', 'theme', 'vibe', 'tones', 'tone', 'colors', 'color', 'palette', 'pal', 'like', 'as'
    ]);

    const PALETTE_KEYWORDS = {
        psychedelic: { hueSeeds: [300, 200, 120, 30], sat: [80, 100], light: [45, 70], contrast: 'high' },
        trippy: { hueSeeds: [300, 190, 90, 30], sat: [80, 100], light: [45, 70], contrast: 'high' },
        neon: { hueSeeds: [320, 180, 90, 45], sat: [85, 100], light: [50, 65], contrast: 'high' },
        vibrant: { sat: [70, 100], light: [45, 70], contrast: 'high' },
        vivid: { sat: [75, 100], light: [45, 70], contrast: 'high' },
        pastel: { sat: [20, 50], light: [70, 85], contrast: 'low' },
        soft: { sat: [20, 45], light: [65, 85], contrast: 'low' },
        muted: { sat: [15, 40], light: [35, 65], contrast: 'low' },
        desaturated: { sat: [10, 35], light: [35, 65], contrast: 'low' },
        warm: { hueSeeds: [10, 30, 45, 0], sat: [50, 85] },
        cool: { hueSeeds: [180, 200, 220, 260], sat: [45, 80] },
        forest: { hueSeeds: [90, 110, 130, 150], sat: [35, 65], light: [30, 55] },
        ocean: { hueSeeds: [180, 200, 220], sat: [45, 75], light: [35, 65] },
        sunset: { hueSeeds: [10, 25, 40, 330], sat: [55, 90], light: [45, 70] },
        sunrise: { hueSeeds: [10, 25, 40, 330], sat: [55, 90], light: [50, 75] },
        aurora: { hueSeeds: [260, 290, 170, 200], sat: [45, 80], light: [55, 80] },
        noir: { hueSeeds: [210, 240, 280], sat: [15, 45], light: [15, 35], contrast: 'high' },
        gothic: { hueSeeds: [280, 320, 220], sat: [20, 55], light: [15, 40], contrast: 'high' },
        dark: { sat: [15, 55], light: [15, 40], contrast: 'high' },
        light: { light: [65, 85], sat: [40, 80], contrast: 'low' },
        bright: { light: [60, 85], sat: [60, 95], contrast: 'high' },
        earthy: { hueSeeds: [20, 35, 60, 90], sat: [20, 55], light: [30, 60] },
        jewel: { hueSeeds: [300, 220, 150, 30], sat: [55, 85], light: [30, 55] },
        berry: { hueSeeds: [330, 350, 310], sat: [55, 85], light: [40, 60] },
        sepia: { hueSeeds: [30, 35, 45], sat: [20, 50], light: [40, 70] },
        vintage: { sat: [20, 50], light: [45, 70] },
        retro: { hueSeeds: [20, 140, 200, 340], sat: [35, 70], light: [40, 70] },
        cyberpunk: { hueSeeds: [300, 190, 90], sat: [80, 100], light: [45, 65], contrast: 'high' },
        vaporwave: { hueSeeds: [300, 330, 190], sat: [60, 90], light: [55, 75] },
        cottagecore: { hueSeeds: [20, 40, 90, 140], sat: [25, 55], light: [65, 85], contrast: 'low' },
        monochrome: { monochrome: true, sat: [0, 5], light: [15, 85] },
        grayscale: { monochrome: true, sat: [0, 5], light: [15, 85] },
        greyscale: { monochrome: true, sat: [0, 5], light: [15, 85] }
    };

    function getCustomPalettes() {
        try {
            const raw = JSON.parse(localStorage.getItem(CUSTOM_PALETTE_KEY) || '{}');
            if (!raw || typeof raw !== 'object') return {};
            const cleaned = {};
            for (const [name, colors] of Object.entries(raw)) {
                const palette = Array.isArray(colors)
                    ? colors.map(c => normalizeHexColor(c, null)).filter(Boolean)
                    : [];
                if (palette.length) cleaned[String(name)] = [...new Set(palette)];
            }
            return cleaned;
        } catch {
            return {};
        }
    }

    function getCustomPaletteMeta() {
        try {
            const raw = JSON.parse(localStorage.getItem(CUSTOM_PALETTE_META_KEY) || '{}');
            return raw && typeof raw === 'object' ? raw : {};
        } catch {
            return {};
        }
    }

    function saveCustomPaletteMeta(meta) {
        try { localStorage.setItem(CUSTOM_PALETTE_META_KEY, JSON.stringify(meta || {})); } catch { }
    }

    function setCustomPaletteMetaEntry(name, entry) {
        const meta = getCustomPaletteMeta();
        meta[String(name)] = entry;
        saveCustomPaletteMeta(meta);
    }

    function deleteCustomPaletteMetaEntry(name) {
        const meta = getCustomPaletteMeta();
        delete meta[String(name)];
        saveCustomPaletteMeta(meta);
    }

    function tokenizePalettePrompt(name, notes) {
        const text = `${name || ''} ${notes || ''}`.toLowerCase();
        const tokens = text.match(/[a-z0-9]+/g) || [];
        return tokens.filter(t => t.length > 1 && !PALETTE_STOPWORDS.has(t));
    }

    function mergeRange(base, next) {
        if (!next) return base;
        if (!base) return [next[0], next[1]];
        const low = Math.max(base[0], next[0]);
        const high = Math.min(base[1], next[1]);
        if (low <= high) return [low, high];
        return [Math.min(base[0], next[0]), Math.max(base[1], next[1])];
    }

    function clampRange(range, min = 0, max = 100) {
        if (!range) return null;
        const lo = Math.max(min, Math.min(max, range[0]));
        const hi = Math.max(min, Math.min(max, range[1]));
        if (lo === hi) return [lo, hi];
        return lo < hi ? [lo, hi] : [hi, lo];
    }

    function applyProfileHint(profile, hint) {
        if (hint.hueSeeds?.length) profile.hueSeeds.push(...hint.hueSeeds);
        if (hint.sat) profile.satRange = clampRange(mergeRange(profile.satRange, hint.sat));
        if (hint.light) profile.lightRange = clampRange(mergeRange(profile.lightRange, hint.light));
        if (hint.contrast === 'high') profile.contrast = Math.max(profile.contrast, 2);
        if (hint.contrast === 'low') profile.contrast = Math.min(profile.contrast, 0);
        if (hint.monochrome) profile.monochrome = true;
    }

    function derivePaletteProfile(tokens) {
        const profile = {
            hueSeeds: [],
            satRange: [45, 85],
            lightRange: [35, 70],
            contrast: 1,
            monochrome: false,
            hueSpread: 28
        };

        for (const token of tokens) {
            if (COLOR_NAME_MAP.has(token)) profile.hueSeeds.push(COLOR_NAME_MAP.get(token));
            const hint = PALETTE_KEYWORDS[token];
            if (hint) applyProfileHint(profile, hint);
        }

        if (profile.monochrome) {
            profile.hueSeeds = [0];
            profile.satRange = [0, 5];
        }

        if (!profile.hueSeeds.length) {
            if (tokens.includes('warm')) profile.hueSeeds = [10, 30, 45, 0];
            else if (tokens.includes('cool')) profile.hueSeeds = [180, 200, 220, 260];
            else profile.hueSeeds = [0, 30, 60, 120, 180, 210, 270, 330];
        }

        if (profile.contrast === 2) {
            profile.lightRange = clampRange([profile.lightRange[0] - 10, profile.lightRange[1] + 10], 5, 95);
        } else if (profile.contrast === 0) {
            const mid = (profile.lightRange[0] + profile.lightRange[1]) / 2;
            const spread = Math.max(6, (profile.lightRange[1] - profile.lightRange[0]) / 2 - 6);
            profile.lightRange = clampRange([mid - spread, mid + spread], 10, 90);
        }

        return profile;
    }

    function isColorTooClose(color, palette) {
        return palette.some(existing => colorDistance(existing, color));
    }

    function buildPaletteFromProfile(profile, count = CUSTOM_PALETTE_SIZE) {
        const palette = [];
        const attemptsLimit = count * 40;
        let attempts = 0;

        if (profile.monochrome) {
            for (let i = 0; i < count; i++) {
                const t = (i + 1) / (count + 1);
                const l = profile.lightRange[0] + (profile.lightRange[1] - profile.lightRange[0]) * t;
                palette.push(hslToHex(0, 0, Math.round(l)));
            }
            return palette;
        }

        const seeds = profile.hueSeeds.slice();
        while (palette.length < count && attempts < attemptsLimit) {
            const idx = palette.length % seeds.length;
            const baseHue = seeds[idx];
            const hue = (baseHue + (Math.random() * 2 - 1) * profile.hueSpread + 360) % 360;
            const sat = profile.satRange[0] + Math.random() * (profile.satRange[1] - profile.satRange[0]);
            const light = profile.lightRange[0] + Math.random() * (profile.lightRange[1] - profile.lightRange[0]);
            const color = hslToHex(hue, Math.round(sat), Math.round(light));
            if (!isColorTooClose(color, palette)) palette.push(color);
            attempts++;
        }

        return palette;
    }

    function sanitizeGeneratedPalette(colors, profile, count = CUSTOM_PALETTE_SIZE) {
        const cleaned = [];
        for (const c of Array.isArray(colors) ? colors : []) {
            const raw = String(c ?? '').trim();
            const candidate = /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}` : raw;
            const normalized = normalizeHexColor(candidate, null);
            if (normalized && !cleaned.includes(normalized)) cleaned.push(normalized);
        }

        let attempts = 0;
        while (cleaned.length < count && attempts < count * 40) {
            const extra = buildPaletteFromProfile(profile, count);
            for (const color of extra) {
                if (!cleaned.includes(color) && !isColorTooClose(color, cleaned)) cleaned.push(color);
                if (cleaned.length >= count) break;
            }
            attempts++;
        }

        if (cleaned.length < count) {
            const fallback = COLOR_THEMES.pastel.map(([h, s, l]) => hslToHex(h, s, l));
            for (const color of fallback) {
                if (!cleaned.includes(color)) cleaned.push(color);
                if (cleaned.length >= count) break;
            }
        }

        return cleaned.slice(0, count);
    }

    function generateHeuristicPalette(name, notes, count = CUSTOM_PALETTE_SIZE) {
        const tokens = tokenizePalettePrompt(name, notes);
        const profile = derivePaletteProfile(tokens);
        const base = buildPaletteFromProfile(profile, count);
        const palette = sanitizeGeneratedPalette(base, profile, count);
        return { palette, profile, tokens };
    }

    async function enhancePaletteWithLLM(name, notes, basePalette, profile, count = CUSTOM_PALETTE_SIZE) {
        if (typeof generateQuietPrompt !== 'function') return null;
        const promptNotes = notes?.trim() ? notes.trim() : 'None';
        const instruction = [
            'Generate a color palette as a JSON array of hex colors.',
            `Theme: "${name}".`,
            `Notes: "${promptNotes}".`,
            `Return exactly ${count} colors.`,
            'Each item must be a string like "#RRGGBB".',
            `Base palette (optional inspiration): ${JSON.stringify(basePalette)}.`,
            'Return ONLY the JSON array and nothing else.'
        ].join(' ');

        const jsonSchema = {
            type: 'array',
            minItems: count,
            maxItems: count,
            items: { type: 'string', pattern: '^#?[0-9a-fA-F]{6}$' }
        };

        let response = '';
        try {
            response = await generateQuietPrompt({
                quietPrompt: instruction,
                skipWIAN: true,
                quietName: `PaletteGen_${Date.now()}`,
                quietToLoud: false,
                jsonSchema
            });
        } catch (e) {
            console.warn('[Dialogue Colors] LLM palette generation failed:', e);
            return null;
        }

        if (!response || typeof response !== 'string') return null;
        let jsonText = response.trim();
        if (!jsonText.startsWith('[')) {
            const match = jsonText.match(/\[[\s\S]*\]/);
            if (!match) return null;
            jsonText = match[0];
        }
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch {
            return null;
        }
        if (!Array.isArray(parsed)) return null;
        const sanitized = sanitizeGeneratedPalette(parsed, profile, count);
        return sanitized.length ? sanitized : null;
    }

    async function generateCustomPaletteFromWords(inputName = '', inputNotes = '') {
        const inlineInputs = getInlinePaletteInputs();
        const name = String(inputName || inlineInputs.name || '').trim();
        if (!name) {
            toastr?.warning?.('Enter a palette name first');
            return;
        }
        const notes = String(inputNotes || inlineInputs.notes || '');
        const customs = getCustomPalettes();
        if (customs[name] && !shouldOverwritePalette()) {
            toastr?.warning?.(`Custom palette "${name}" exists. Enable "Overwrite existing" to replace it.`);
            return;
        }

        const { palette: basePalette, profile } = generateHeuristicPalette(name, notes);
        let finalPalette = basePalette;
        let source = 'heuristic';

        if (settings.llmEnhanceCustomPalettes !== false) {
            const enhanced = await enhancePaletteWithLLM(name, notes, basePalette, profile, CUSTOM_PALETTE_SIZE);
            if (enhanced) {
                finalPalette = enhanced;
                source = 'llm';
            } else {
                source = 'hybrid-fallback';
                toastr?.info?.('LLM enhancement unavailable, used local palette');
            }
        }

        customs[name] = finalPalette;
        localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(customs));
        setCustomPaletteMetaEntry(name, { source, notes: notes.trim(), createdAt: Date.now() });
        refreshPaletteDropdown();
        const label = source === 'llm' ? 'LLM-enhanced' : (source === 'hybrid-fallback' ? 'local fallback' : 'local');
        toastr?.success?.(`Custom palette "${name}" saved (${label})`);
    }

    function saveCustomPalette() {
        const { name } = getInlinePaletteInputs();
        if (!name) {
            toastr?.warning?.('Enter a palette name first');
            return;
        }
        const colors = [...new Set(Object.values(characterColors).map(c => normalizeHexColor(c.color, null)).filter(Boolean))];
        if (!colors.length) { toastr?.warning?.('No characters to save palette from'); return; }
        const customs = getCustomPalettes();
        if (customs[name] && !shouldOverwritePalette()) {
            toastr?.warning?.(`Custom palette "${name}" exists. Enable "Overwrite existing" to replace it.`);
            return;
        }
        customs[name] = colors;
        localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(customs));
        setCustomPaletteMetaEntry(name, { source: 'heuristic', notes: '', createdAt: Date.now() });
        refreshPaletteDropdown();
        toastr?.success?.(`Custom palette "${name}" saved`);
    }

    function deleteCustomPalette() {
        const select = document.getElementById('dc-palette');
        if (!select?.value?.startsWith('custom:')) { toastr?.warning?.('Select a custom palette first'); return; }
        const paletteName = select.value.slice(7);
        const customs = getCustomPalettes();
        delete customs[paletteName];
        localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(customs));
        deleteCustomPaletteMetaEntry(paletteName);
        settings.colorTheme = 'pastel';
        saveData();
        invalidateThemeCache();
        refreshPaletteDropdown();
        injectPrompt();
        toastr?.success?.(`Custom palette "${paletteName}" deleted`);
    }

    function refreshPaletteDropdown() {
        const select = document.getElementById('dc-palette');
        if (!select) return;
        const builtinOptions = Object.keys(COLOR_THEMES).map(k => {
            const safeKey = escapeAttr(k);
            const safeLabel = escapeHtml(k.charAt(0).toUpperCase() + k.slice(1));
            return `<option value="${safeKey}">${safeLabel}</option>`;
        }).join('');
        const customs = getCustomPalettes();
        const customNames = Object.keys(customs);
        const customOptions = customNames.length ? `<optgroup label="Custom">${customNames.map(n => {
            const safeName = escapeAttr(n);
            return `<option value="custom:${safeName}">${safeName}</option>`;
        }).join('')}</optgroup>` : '';
        select.innerHTML = builtinOptions + customOptions;
        select.value = settings.colorTheme;
        if (select.value !== settings.colorTheme) {
            settings.colorTheme = 'pastel';
            select.value = 'pastel';
        }
    }

    // Phase 5D: Color harmony suggestions
    function getHarmonySuggestions(hex) {
        const [h, s, l] = hexToHsl(hex);
        return [
            { label: 'Complementary', color: hslToHex((h + 180) % 360, s, l) },
            { label: 'Triadic 1', color: hslToHex((h + 120) % 360, s, l) },
            { label: 'Triadic 2', color: hslToHex((h + 240) % 360, s, l) },
            { label: 'Analogous +', color: hslToHex((h + 30) % 360, s, l) },
            { label: 'Analogous -', color: hslToHex((h + 330) % 360, s, l) }
        ];
    }

    function showHarmonyPopup(key, anchorEl) {
        const existing = document.getElementById('dc-harmony-popup');
        if (existing) existing.remove();
        const char = characterColors[key];
        if (!char) return;
        const suggestions = getHarmonySuggestions(getBaseColor(char));
        const popup = document.createElement('div');
        popup.id = 'dc-harmony-popup';
        const rect = anchorEl.getBoundingClientRect();
        popup.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;background:var(--SmartThemeBlurTintColor, #1a1a2e);border:1px solid var(--SmartThemeBorderColor, #4a4a6a);border-radius:6px;padding:8px;z-index:10001;display:flex;gap:6px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
        popup.innerHTML = suggestions.map(s => `<div class="dc-harmony-swatch" data-color="${s.color}" title="${s.label}: ${s.color}" style="width:24px;height:24px;border-radius:4px;background:${s.color};cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;"></div>`).join('');
        document.body.appendChild(popup);
        const popupRect = popup.getBoundingClientRect();
        if (popupRect.right > window.innerWidth) popup.style.left = (window.innerWidth - popupRect.width - 8) + 'px';
        if (popupRect.bottom > window.innerHeight) popup.style.top = (window.innerHeight - popupRect.height - 8) + 'px';
        popup.querySelectorAll('.dc-harmony-swatch').forEach(swatch => {
            swatch.onmouseenter = () => { swatch.style.borderColor = '#fff'; };
            swatch.onmouseleave = () => { swatch.style.borderColor = 'transparent'; };
            swatch.onclick = () => {
                setEntryFromBaseColor(char, swatch.dataset.color);
                saveHistory(); saveData(); updateCharList(); injectPrompt();
                popup.remove();
                if (settings.autoRecolor) recolorAllMessages();
            };
        });
        const closePopup = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
        setTimeout(() => document.addEventListener('mousedown', closePopup), 10);
    }

    // Phase 6B: Group sorting support
    function getSortedEntries() {
        const entries = Object.entries(characterColors).filter(([, v]) => !searchTerm || v.name.toLowerCase().includes(searchTerm.toLowerCase()));
        if (sortMode === 'count') entries.sort((a, b) => (b[1].dialogueCount || 0) - (a[1].dialogueCount || 0));
        else if (sortMode === 'group') entries.sort((a, b) => (a[1].group || '').localeCompare(b[1].group || '') || a[1].name.localeCompare(b[1].name));
        else entries.sort((a, b) => a[1].name.localeCompare(b[1].name));
        return entries;
    }

    function getBadge(count) {
        if (count >= 100) return '💎';
        if (count >= 50) return '⭐';
        return '';
    }

    function detectTheme() {
        const background = getComputedStyle(document.body).backgroundColor || '';
        if (cachedTheme && cachedThemeBackground === background) return cachedTheme;
        const m = background.match(/\d+/g);
        cachedTheme = m && m.length >= 3 && (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000 < 128 ? 'dark' : 'light';
        cachedThemeBackground = background;
        return cachedTheme;
    }
    function invalidateThemeCache() { cachedTheme = null; cachedThemeBackground = null; cachedIsDark = null; }

    function getThemeLightnessBounds() {
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        return mode === 'dark'
            ? { mode, minLightness: 45, maxLightness: 92 }
            : { mode, minLightness: 12, maxLightness: 65 };
    }

    function applyThemeReadabilityAndBrightness(hexColor) {
        const normalized = normalizeHexColor(hexColor);
        const [h, s, l] = hexToHsl(normalized);
        const brightness = Number(settings.brightness);
        const offset = Number.isFinite(brightness) ? Math.max(-100, Math.min(100, brightness)) : 0;
        const { minLightness, maxLightness } = getThemeLightnessBounds();
        const adjustedL = Math.max(minLightness, Math.min(maxLightness, l + offset));
        return hslToHex(h, s, adjustedL);
    }

    function deriveBaseColorFromEffectiveColor(hexColor) {
        const normalized = normalizeHexColor(hexColor);
        const [h, s, l] = hexToHsl(normalized);
        const brightness = Number(settings.brightness);
        const offset = Number.isFinite(brightness) ? Math.max(-100, Math.min(100, brightness)) : 0;
        const baseL = Math.max(0, Math.min(100, l - offset));
        return hslToHex(h, s, baseL);
    }

    function getBaseColor(entry, fallback = '#888888') {
        const colorFallback = normalizeHexColor(entry?.color, fallback);
        return normalizeHexColor(entry?.baseColor, colorFallback);
    }

    function getEntryEffectiveColor(entry) {
        return applyThemeReadabilityAndBrightness(getBaseColor(entry));
    }

    function setEntryFromBaseColor(entry, baseColor) {
        if (!entry) return '#888888';
        entry.baseColor = normalizeHexColor(baseColor, getBaseColor(entry));
        entry.color = getEntryEffectiveColor(entry);
        return entry.color;
    }

    function setEntryFromEffectiveColor(entry, effectiveColor) {
        if (!entry) return '#888888';
        const normalizedEffective = normalizeHexColor(effectiveColor, entry.color);
        entry.baseColor = deriveBaseColorFromEffectiveColor(normalizedEffective);
        entry.color = getEntryEffectiveColor(entry);
        return entry.color;
    }

    function syncAllEffectiveColors() {
        for (const entry of Object.values(characterColors)) {
            if (!entry) continue;
            setEntryFromBaseColor(entry, getBaseColor(entry));
        }
    }

    // Phase 2B: Prefer characterId over avatar, use ?? for 0-safety
    function getCharKey() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            return char?.characterId ?? char?.avatar ?? ctx?.characterId ?? null;
        } catch { return null; }
    }

    // Phase 2B: Legacy key for migration (old behavior: avatar || characterId)
    function getLegacyCharKey() {
        try {
            const ctx = getContext();
            return ctx?.characters?.[ctx?.characterId]?.avatar || ctx?.characterId || null;
        } catch { return null; }
    }

    function getStorageKey() { return settings.shareColorsGlobally ? 'dc_global' : `dc_char_${getCharKey() || 'default'}`; }
    function getLegacyStorageKey() { return settings.shareColorsGlobally ? 'dc_global' : `dc_char_${getLegacyCharKey() || 'default'}`; }

    // Extract dominant color from avatar image
    async function extractAvatarColor(imgSrc) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 50; canvas.height = 50;
                ctx.drawImage(img, 0, 0, 50, 50);
                const data = ctx.getImageData(0, 0, 50, 50).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 128) continue;
                    r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
                }
                if (count === 0) { resolve(null); return; }
                r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
                resolve(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
            };
            img.onerror = () => resolve(null);
            img.src = imgSrc;
        });
    }

    // Phase 4A: Theme-aware PNG export
    function exportLegendPng() {
        const entries = Object.entries(characterColors);
        if (!entries.length) { toastr?.info?.('No characters to export'); return; }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const lineHeight = 24, padding = 16, dotSize = 10;
        canvas.width = 300;
        canvas.height = entries.length * lineHeight + padding * 2;
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        ctx.fillStyle = mode === 'dark' ? '#1a1a2e' : '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        entries.forEach(([, v], i) => {
            const y = padding + i * lineHeight + lineHeight / 2;
            const safeColor = getEntryEffectiveColor(v);
            ctx.beginPath();
            ctx.arc(padding + dotSize / 2, y, dotSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = safeColor;
            ctx.fill();
            ctx.fillStyle = safeColor;
            ctx.font = '14px sans-serif';
            ctx.fillText(v.name, padding + dotSize + 8, y + 5);
        });
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `dialogue-colors-legend-${Date.now()}.png`;
        a.click();
        toastr?.success?.('Legend exported');
    }

    // Right-click and long-press context menu for messages
    function setupContextMenu() {
        let longPressTimer = null;
        let longPressTarget = null;

        const showMenu = (e, fontTag) => {
            e.preventDefault();
            const existingMenu = document.getElementById('dc-context-menu');
            if (existingMenu) existingMenu.remove();
            const color = normalizeHexColor(fontTag.getAttribute('color'));
            const text = fontTag.textContent.substring(0, 30) + (fontTag.textContent.length > 30 ? '...' : '');
            const menu = document.createElement('div');
            menu.id = 'dc-context-menu';
            const x = e.clientX ?? e.touches?.[0]?.clientX ?? 100;
            const y = e.clientY ?? e.touches?.[0]?.clientY ?? 100;
            menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;z-index:10001;min-width:180px;color:var(--SmartThemeTextColor);box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
            menu.innerHTML = `
                <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;">"${escapeHtml(text)}"</div>
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${color};"></span>
                    <input type="color" id="dc-ctx-color" value="${color}" style="width:24px;height:20px;border:none;">
                    <input type="text" id="dc-ctx-name" placeholder="Character name" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;">
                </div>
                <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;">Assign to Character</button>
                <button id="dc-ctx-close" class="menu_button" style="width:100%;">Cancel</button>
            `;
            document.body.appendChild(menu);
            const menuRect = menu.getBoundingClientRect();
            if (menuRect.right > window.innerWidth) menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
            if (menuRect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
            menu.querySelector('#dc-ctx-close').onclick = () => menu.remove();
            menu.querySelector('#dc-ctx-assign').onclick = () => {
                const nameInput = menu.querySelector('#dc-ctx-name');
                const colorInput = menu.querySelector('#dc-ctx-color');
                const name = nameInput.value.trim();
                const newColor = normalizeHexColor(colorInput.value, color);
                if (name) {
                    const key = name.toLowerCase();
                    if (characterColors[key]) {
                        setEntryFromEffectiveColor(characterColors[key], newColor);
                    } else {
                        const baseColor = deriveBaseColorFromEffectiveColor(newColor);
                        characterColors[key] = { color: applyThemeReadabilityAndBrightness(baseColor), baseColor, name, locked: false, aliases: [], style: '', dialogueCount: 1, group: '' };
                    }
                    saveHistory(); saveData(); updateCharList(); injectPrompt();
                    toastr?.success?.(`Assigned to ${name}`);
                }
                menu.remove();
            };
            const closeMenu = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', closeMenu); document.removeEventListener('touchstart', closeMenu); } };
            setTimeout(() => { document.addEventListener('click', closeMenu); document.addEventListener('touchstart', closeMenu); }, 10);
        };

        document.addEventListener('contextmenu', e => {
            if (!settings.enableRightClick) return;
            const fontTag = e.target.closest('font[color]');
            const mesText = e.target.closest('.mes_text');
            if (!fontTag || !mesText) return;
            showMenu(e, fontTag);
        });

        document.addEventListener('touchstart', e => {
            if (!settings.enableRightClick) return;
            const fontTag = e.target.closest('font[color]');
            const mesText = e.target.closest('.mes_text');
            if (!fontTag || !mesText) return;
            longPressTarget = fontTag;
            longPressTimer = setTimeout(() => showMenu(e, fontTag), 500);
        }, { passive: true });

        document.addEventListener('touchend', () => { clearTimeout(longPressTimer); longPressTimer = null; });
        document.addEventListener('touchmove', () => { clearTimeout(longPressTimer); longPressTimer = null; });
    }

    function saveData() {
        characterColors = normalizeCharacterColors(characterColors);
        settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
        syncAllEffectiveColors();
        localStorage.setItem(getStorageKey(), JSON.stringify({ colors: characterColors, settings }));
        localStorage.setItem('dc_global_settings', JSON.stringify({ thoughtSymbols: settings.thoughtSymbols, themeMode: settings.themeMode, colorTheme: settings.colorTheme, brightness: settings.brightness }));
    }

    // Phase 1B: Deduplicated global settings load via applyGlobal helper
    function applyGlobal(g) {
        if (!g) return;
        if (g.thoughtSymbols !== undefined) settings.thoughtSymbols = g.thoughtSymbols;
        if (g.themeMode !== undefined) settings.themeMode = g.themeMode;
        if (g.colorTheme !== undefined) settings.colorTheme = g.colorTheme;
        if (g.brightness !== undefined) settings.brightness = g.brightness;
    }

    function migrateColorSchemaIfNeeded() {
        const currentVersion = Number(settings.colorSchemaVersion);
        const needsMigration = !Number.isFinite(currentVersion) || currentVersion < COLOR_SCHEMA_VERSION;
        let changed = false;
        for (const entry of Object.values(characterColors)) {
            if (!entry) continue;
            if (needsMigration) {
                entry.baseColor = deriveBaseColorFromEffectiveColor(entry.color);
                changed = true;
            } else {
                const normalizedBase = getBaseColor(entry);
                if (normalizeHexColor(entry.baseColor, '') !== normalizedBase) {
                    entry.baseColor = normalizedBase;
                    changed = true;
                }
            }
            const effective = getEntryEffectiveColor(entry);
            if (normalizeHexColor(entry.color) !== effective) changed = true;
            entry.color = effective;
        }
        if (settings.colorSchemaVersion !== COLOR_SCHEMA_VERSION) {
            settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
            changed = true;
        }
        return changed;
    }

    // Phase 2B: Legacy key fallback in loadData
    function loadData() {
        characterColors = {};
        let g = null;
        try { g = JSON.parse(localStorage.getItem('dc_global_settings')); } catch { }
        applyGlobal(g);
        const primaryKey = getStorageKey();
        let loaded = false;
        try {
            const d = JSON.parse(localStorage.getItem(primaryKey));
            if (d?.colors) { characterColors = normalizeCharacterColors(d.colors); loaded = true; }
            if (d?.settings) {
                Object.assign(settings, d.settings);
                if (d.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
            } else if (d?.colors) {
                settings.colorSchemaVersion = 0;
            }
        } catch { }
        if (!loaded) {
            const legacyKey = getLegacyStorageKey();
            if (legacyKey !== primaryKey) {
                try {
                    const d = JSON.parse(localStorage.getItem(legacyKey));
                    if (d?.colors) { characterColors = normalizeCharacterColors(d.colors); loaded = true; }
                    if (d?.settings) {
                        Object.assign(settings, d.settings);
                        if (d.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
                    } else if (d?.colors) {
                        settings.colorSchemaVersion = 0;
                    }
                } catch { }
            }
        }
        applyGlobal(g);
        if (migrateColorSchemaIfNeeded()) {
            saveData();
        }
        colorHistory = [JSON.stringify(characterColors)]; historyIndex = 0;
        lastProcessedMessageSignature = '';
    }

    function exportColors() {
        const blob = new Blob([JSON.stringify({ colors: characterColors, settings }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function importColors(file) {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const d = JSON.parse(e.target.result);
                if (d.colors) characterColors = normalizeCharacterColors(d.colors);
                if (d.settings) {
                    Object.assign(settings, d.settings);
                    if (d.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
                } else if (d.colors) {
                    settings.colorSchemaVersion = 0;
                }
                migrateColorSchemaIfNeeded();
                saveHistory(); saveData(); updateCharList(); injectPrompt();
                toastr?.success?.('Imported!');
            } catch {
                toastr?.error?.('Invalid file');
            }
        };
        reader.readAsText(file);
    }

    // Phase 7: Removed debug console.log statements
    function ensureRegexScript() {
        try {
            if (!extension_settings || typeof extension_settings !== 'object') return;
            if (!Array.isArray(extension_settings.regex)) extension_settings.regex = [];

            const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });

            if (!extension_settings.regex.some(r => r?.scriptName === 'Trim Font Colors')) {
                extension_settings.regex.push({
                    id: uuidv4(),
                    scriptName: 'Trim Font Colors',
                    findRegex: '/<\\/?font[^>]*>/gi',
                    replaceString: '',
                    trimStrings: [],
                    placement: [2],
                    disabled: false,
                    markdownOnly: false,
                    promptOnly: true,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: null,
                    maxDepth: null
                });
                saveSettingsDebounced?.();
            }

            if (!extension_settings.regex.some(r => r?.scriptName === 'Trim Color Blocks')) {
                extension_settings.regex.push({
                    id: uuidv4(),
                    scriptName: 'Trim Color Blocks',
                    findRegex: '/\\[COLORS?:[^\\]]*\\]/gi',
                    replaceString: '',
                    trimStrings: [],
                    placement: [2],
                    disabled: false,
                    markdownOnly: true,
                    promptOnly: true,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: null,
                    maxDepth: null
                });
                saveSettingsDebounced?.();
            }

            if (!extension_settings.regex.some(r => r?.scriptName === 'Trim CSS Effects (Prompt)')) {
                extension_settings.regex.push({
                    id: uuidv4(),
                    scriptName: 'Trim CSS Effects (Prompt)',
                    findRegex: '/<span[^>]*style=["\'][^"\']*(?:transform|skew|rotate|scale)[^"\']*["\'][^>]*>(.*?)<\\/span>/gi',
                    replaceString: '$1',
                    trimStrings: [],
                    placement: [2],
                    disabled: false,
                    markdownOnly: false,
                    promptOnly: true,
                    runOnEdit: true,
                    substituteRegex: 0,
                    minDepth: null,
                    maxDepth: null
                });
                saveSettingsDebounced?.();
            }
        } catch (e) {
            console.error('[Dialogue Colors] Failed to import regex scripts:', e);
        }
    }

    const PALETTE_DESCRIPTIONS = {
        pastel: 'Use soft pastel tones.',
        neon: 'Use vivid neon colors.',
        earth: 'Use earthy, natural tones.',
        jewel: 'Use rich jewel tones.',
        muted: 'Use muted, desaturated tones.',
        jade: 'Use jade/teal greens.',
        forest: 'Use forest/woodland greens.',
        ocean: 'Use ocean/aquatic blues.',
        sunset: 'Use sunset colors (oranges, pinks, golds).',
        aurora: 'Use aurora/northern lights purples and greens.',
        warm: 'Use warm tones (reds, oranges, yellows).',
        cool: 'Use cool tones (blues, teals, purples).',
        berry: 'Use berry/magenta shades.',
        monochrome: 'Use only grayscale.',
        protanopia: 'Use colorblind-safe colors (protanopia type).',
        deuteranopia: 'Use colorblind-safe colors (deuteranopia type).',
        tritanopia: 'Use colorblind-safe colors (tritanopia type).',
    };

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const { mode, minLightness, maxLightness } = getThemeLightnessBounds();
        const thoughtSymbols = [...new Set(String(settings.thoughtSymbols || '').split('').filter(s => s && s.trim()))];
        const delimiterSymbols = [...new Set(['"', ...thoughtSymbols])];
        const delimiterSymbolList = delimiterSymbols.map(s => `"${s.replace(/"/g, '\\"')}"`).join(', ');
        const colorList = Object.entries(characterColors)
            .filter(([, v]) => v.locked && v.color)
            .map(([, v]) => `${v.name}=${getEntryEffectiveColor(v)}${v.style ? ` (${v.style})` : ''}`)
            .join(', ');
        const aliases = Object.entries(characterColors).filter(([, v]) => v.aliases?.length).map(([, v]) => `${v.name}/${v.aliases.join('/')}`).join('; ');
        const parts = [
            `[Font Color Rule: Wrap ALL dialogue in <font color=#RRGGBB> tags, and include surrounding dialogue/thought delimiter symbols inside the same colored span.`,
            mode === 'dark' ? 'Use readable colors for a dark background. HARD RULE: Never use dark colors in dark mode. Use medium-to-light colors only; avoid low-lightness shades.' : 'Use readable colors for a light background. HARD RULE: Never use bright colors in light mode. Use medium-to-dark colors only; avoid high-lightness shades.',
        ];
        parts.push(`Delimiter rule: always color delimiter symbols too (do not leave them uncolored). Symbols: ${delimiterSymbolList}.`);
        parts.push(`HARD RANGE: Keep color lightness between ${minLightness}% and ${maxLightness}% for ${mode} mode. This range is enforced.`);
        if (settings.brightness > 0) parts.push(`Apply +${settings.brightness}% lightness offset, then clamp to the hard range.`);
        if (settings.brightness < 0) parts.push(`Apply -${Math.abs(settings.brightness)}% lightness offset, then clamp to the hard range.`);
        const customPalettePrompt = buildCustomPalettePrompt();
        if (customPalettePrompt) {
            parts.push(customPalettePrompt);
        } else {
            const paletteDesc = PALETTE_DESCRIPTIONS[settings.colorTheme];
            if (paletteDesc) parts.push(paletteDesc);
        }
        if (colorList) parts.push(`Keep: ${colorList}.`);
        if (aliases) parts.push(`Aliases: ${aliases}.`);
        if (!settings.disableNarration && settings.narratorColor) parts.push(`Narrator: ${applyThemeReadabilityAndBrightness(settings.narratorColor)}.`);
        if (settings.thoughtSymbols) parts.push(`Inner thoughts using ${settings.thoughtSymbols} must color BOTH opening/closing symbol(s) and enclosed text with the speaker's color.`);
        if (settings.highlightMode) parts.push('Add background highlight.');
        if (settings.cssEffects) parts.push(`For intense emotion/magic/distortion, use CSS transforms: chaos=rotate(2deg) skew(5deg), magic=scale(1.2), unease=skew(-10deg), rage=uppercase, whispers=lowercase. Wrap in <span style='transform:X; display:inline-block; background:transparent;'>text</span>.`);
        parts.push('Give new characters unique colors.');
        parts.push('End your response with: [COLORS:Name=#RRGGBB,Name2=#RRGGBB] for all speakers.');
        if (!settings.disableNarration) parts.push('Include Narrator=#RRGGBB if narration is used.');
        parts.push('Include nicknames as Name(Nick)=#RRGGBB.]');
        return parts.join(' ');
    }

    function buildCustomPalettePrompt() {
        if (!settings.colorTheme?.startsWith('custom:')) return '';
        const paletteName = settings.colorTheme.slice(7);
        if (!paletteName) return '';
        const customs = getCustomPalettes();
        const palette = customs[paletteName];
        if (!Array.isArray(palette) || !palette.length) return '';
        const meta = getCustomPaletteMeta();
        const notes = meta?.[paletteName]?.notes?.trim() || '';
        const colors = palette.map(c => normalizeHexColor(c, null)).filter(Boolean).join(', ');
        if (!colors) return '';
        const notesPart = notes ? ` Theme notes: ${notes}.` : '';
        return `Use custom palette "${paletteName}": ${colors}.${notesPart} Prefer these hues when assigning new character colors.`;
    }

    function buildColoredPromptPreview() {
        if (!settings.enabled) return '<span style="opacity:0.5">(disabled)</span>';
        const entries = Object.entries(characterColors);
        if (!entries.length) return '<span style="opacity:0.5">(no characters)</span>';
        return entries.map(([, v]) => `<span style="color:${getEntryEffectiveColor(v)}">${escapeHtml(v.name)}</span>`).join(', ');
    }

    function injectPrompt() {
        if (injectDebouncedTimer) clearTimeout(injectDebouncedTimer);
        injectDebouncedTimer = setTimeout(() => {
            setExtensionPrompt(MODULE_NAME, settings.enabled ? buildPromptInstruction() : '', extension_prompt_types.IN_CHAT, settings.promptDepth, false, extension_prompt_roles.SYSTEM);
            const p = document.getElementById('dc-prompt-preview');
            if (p) p.innerHTML = buildColoredPromptPreview();
        }, 50);
    }

    // Phase 3A: Legend with event listener cleanup
    function createLegend() {
        let legend = document.getElementById('dc-legend-float');
        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'dc-legend-float';

            const savedPos = JSON.parse(localStorage.getItem('dc_legend_position') || '{}');
            const top = savedPos.top ?? 60;
            const left = savedPos.left;
            const right = savedPos.right ?? 10;

            legend.style.cssText = `position:fixed;top:${top}px;${left !== undefined ? `left:${left}px;` : `right:${right}px;`}background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:9999;font-size:0.8em;max-width:150px;max-height:60vh;overflow-y:auto;display:none;cursor:move;user-select:none;`;

            let isDragging = false;
            let startX, startY, startLeft, startTop;

            const onMouseDown = (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                isDragging = true;
                const rect = legend.getBoundingClientRect();
                startX = e.clientX ?? e.touches?.[0]?.clientX;
                startY = e.clientY ?? e.touches?.[0]?.clientY;
                if (startX == null || startY == null) return;
                startLeft = rect.left;
                startTop = rect.top;
                legend.style.right = 'auto';
                legend.style.left = startLeft + 'px';
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const clientX = e.clientX ?? e.touches?.[0]?.clientX;
                const clientY = e.clientY ?? e.touches?.[0]?.clientY;
                if (clientX == null || clientY == null) return;
                const dx = clientX - startX;
                const dy = clientY - startY;
                let newLeft = startLeft + dx;
                let newTop = startTop + dy;
                const rect = legend.getBoundingClientRect();
                newLeft = Math.max(0, Math.min(window.innerWidth - rect.width, newLeft));
                newTop = Math.max(0, Math.min(window.innerHeight - rect.height, newTop));
                legend.style.left = newLeft + 'px';
                legend.style.top = newTop + 'px';
            };

            const onMouseUp = () => {
                if (isDragging) {
                    isDragging = false;
                    const rect = legend.getBoundingClientRect();
                    localStorage.setItem('dc_legend_position', JSON.stringify({ top: rect.top, left: rect.left }));
                }
            };

            // Remove old document-level listeners before adding new ones
            if (legendListeners) {
                document.removeEventListener('mousemove', legendListeners.onMouseMove);
                document.removeEventListener('touchmove', legendListeners.onMouseMove);
                document.removeEventListener('mouseup', legendListeners.onMouseUp);
                document.removeEventListener('touchend', legendListeners.onMouseUp);
            }

            legend.addEventListener('mousedown', onMouseDown);
            legend.addEventListener('touchstart', onMouseDown, { passive: false });
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('touchmove', onMouseMove, { passive: false });
            document.addEventListener('mouseup', onMouseUp);
            document.addEventListener('touchend', onMouseUp);

            legendListeners = { onMouseMove, onMouseUp };

            document.body.appendChild(legend);
        }
        return legend;
    }

    function updateLegend() {
        const legend = createLegend();
        const entries = Object.entries(characterColors);
        if (!entries.length || !settings.showLegend) { legend.style.display = 'none'; return; }
        legend.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;cursor:grab;">⋮⋮ Characters</div>' +
            entries.map(([, v]) => {
                const safeColor = getEntryEffectiveColor(v);
                return `<div style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${safeColor};"></span><span style="color:${safeColor}">${escapeHtml(v.name)}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount || 0}</span></div>`;
            }).join('');
        legend.style.display = settings.showLegend ? 'block' : 'none';
    }

    function getDialogueStats() {
        const entries = Object.entries(characterColors);
        const total = entries.reduce((s, [, v]) => s + (v.dialogueCount || 0), 0);
        return entries.map(([, v]) => ({ name: v.name, count: v.dialogueCount || 0, pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0, color: getEntryEffectiveColor(v) })).sort((a, b) => b.count - a.count);
    }

    function showStatsPopup() {
        const stats = getDialogueStats();
        if (!stats.length) { toastr?.info?.('No dialogue data'); return; }
        const maxCount = Math.max(...stats.map(s => s.count), 1);
        let html = stats.map(s => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;"><span style="width:60px;color:${s.color}">${escapeHtml(s.name)}</span><div style="flex:1;height:12px;background:var(--SmartThemeBlurTintColor);border-radius:3px;overflow:hidden;"><div style="width:${s.count / maxCount * 100}%;height:100%;background:${s.color};"></div></div><span style="width:40px;text-align:right;font-size:0.8em;">${s.count} (${s.pct}%)</span></div>`).join('');
        const popup = document.createElement('div');
        popup.id = 'dc-stats-popup';
        popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Dialogue Statistics</div>${html}<button class="dc-close-popup menu_button" style="margin-top:10px;width:100%;">Close</button>`;
        popup.querySelector('.dc-close-popup').onclick = () => popup.remove();
        document.body.appendChild(popup);
        const closePopup = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
        setTimeout(() => document.addEventListener('mousedown', closePopup), 10);
    }

    function saveToCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            if (!char) { toastr?.error?.('No character loaded'); return; }
            if (!char.data) char.data = {};
            if (!char.data.extensions) char.data.extensions = {};
            char.data.extensions.dialogueColors = { colors: normalizeCharacterColors(characterColors), settings };
            saveData();
            saveCharacterDebounced?.();
            toastr?.success?.('Saved to card');
        } catch { toastr?.error?.('Failed to save to card'); }
    }

    function loadFromCard() {
        try {
            const ctx = getContext();
            const charId = ctx?.characterId;
            if (charId === undefined) { toastr?.error?.('No character loaded'); return; }

            getCharacters?.().then(() => {
                const char = ctx?.characters?.[charId];
                const data = char?.data?.extensions?.dialogueColors;
                if (data?.colors) {
                    characterColors = normalizeCharacterColors(data.colors);
                    if (data.settings) {
                        Object.assign(settings, data.settings);
                        if (data.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
                    } else {
                        settings.colorSchemaVersion = 0;
                    }
                    migrateColorSchemaIfNeeded();
                    saveHistory(); saveData(); updateCharList(); injectPrompt();
                    toastr?.success?.('Loaded from card');
                } else {
                    toastr?.info?.('No saved colors in card');
                }
            }).catch(() => toastr?.error?.('Failed to reload character'));
        } catch { toastr?.error?.('Failed to load from card'); }
    }

    function tryLoadFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const data = char?.data?.extensions?.dialogueColors;
            if (data?.colors) {
                characterColors = normalizeCharacterColors(data.colors);
                if (data.settings) {
                    Object.assign(settings, data.settings);
                    if (data.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
                } else {
                    settings.colorSchemaVersion = 0;
                }
                migrateColorSchemaIfNeeded();
                saveHistory(); saveData();
            }
        } catch { }
    }

    function parseNameWithNicknames(rawName) {
        const match = rawName.match(/^([^(]+)(.*)$/);
        if (!match) return { name: rawName.trim(), nicknames: [] };
        const name = match[1].trim();
        const nicknames = [...rawName.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim()).filter(Boolean);
        return { name, nicknames };
    }

    // Phase 1A: Shared color-pair processing — deduplicates parseColorBlock, scanAllMessages, onNewMessage
    // Also fixes auto-lock inconsistency (2A) and adds group field (6B)
    function processColorPairs(pairsString) {
        let foundNew = false;
        const colorPairs = pairsString.split(',');
        for (const pair of colorPairs) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) continue;
            const rawName = pair.substring(0, eqIdx).trim();
            const { name, nicknames } = parseNameWithNicknames(rawName);
            const rawColor = pair.substring(eqIdx + 1).trim();
            if (!name || !rawColor || !/^#[a-fA-F0-9]{6}$/i.test(rawColor)) continue;
            const baseColor = normalizeHexColor(rawColor);
            const color = applyThemeReadabilityAndBrightness(baseColor);
            const key = name.toLowerCase();
            if (characterColors[key]) {
                characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1;
                if (!characterColors[key].locked) {
                    characterColors[key].baseColor = baseColor;
                    characterColors[key].color = color;
                } else {
                    characterColors[key].baseColor = getBaseColor(characterColors[key]);
                }
            } else {
                characterColors[key] = { color, baseColor, name, locked: settings.autoLockDetected !== false, aliases: [], style: '', dialogueCount: 1, group: '' };
                foundNew = true;
            }
            if (nicknames.length) {
                characterColors[key].aliases = characterColors[key].aliases || [];
                nicknames.forEach(nick => {
                    if (!characterColors[key].aliases.includes(nick)) {
                        characterColors[key].aliases.push(nick);
                    }
                });
            }
        }
        return foundNew;
    }

    function parseColorBlock(element) {
        const mesText = element.querySelector?.('.mes_text') || element;
        if (!mesText) return false;
        const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;
        let match, foundNew = false;
        // Parse from textContent for data extraction
        while ((match = colorBlockRegex.exec(mesText.textContent)) !== null) {
            if (processColorPairs(match[1])) foundNew = true;
        }
        stripColorBlockFromElement(mesText);
        return foundNew;
    }

    function stripColorBlockFromElement(element) {
        const mesText = element?.querySelector?.('.mes_text') || element;
        if (!mesText) return false;
        const before = mesText.innerHTML;
        const cleaned = before.replace(/\[COLORS?:.*?\]/gis, '');
        if (cleaned === before) return false;
        mesText.innerHTML = cleaned;
        return true;
    }

    function stripColorBlocksFromDisplay() {
        let removed = false;
        document.querySelectorAll('.mes_text').forEach(el => {
            if (stripColorBlockFromElement(el)) removed = true;
        });
        return removed;
    }

    function scanAllMessages() {
        Object.values(characterColors).forEach(c => c.dialogueCount = 0);
        const ctx = getContext();
        const chat = ctx?.chat || [];
        const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;

        for (const msg of chat) {
            const text = msg?.mes || '';
            let match;
            while ((match = colorBlockRegex.exec(text)) !== null) {
                processColorPairs(match[1]);
            }
        }

        saveHistory(); saveData(); updateCharList(); injectPrompt();
        stripColorBlocksFromDisplay();
        const conflicts = checkColorConflicts();
        if (conflicts.length) toastr?.warning?.(`Similar: ${conflicts.slice(0, 3).map(c => c.join(' & ')).join(', ')}`);
        toastr?.info?.(`Found ${Object.keys(characterColors).length} characters`);
    }

    function setRecolorButtonBusy(isBusyState) {
        const button = document.getElementById('dc-recolor');
        if (!button) return;
        if (isBusyState) {
            if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Recolor';
            button.disabled = true;
            button.textContent = 'Recoloring...';
            return;
        }
        button.disabled = false;
        button.textContent = button.dataset.defaultLabel || 'Recolor';
    }

    async function recolorAllMessages() {
        const ctx = getContext();
        const chat = ctx?.chat || [];
        if (!chat.length) { toastr?.info?.('No messages to recolor.'); return; }
        if (isRecoloring) { toastr?.info?.('Recolor is already running.'); return; }
        isRecoloring = true;
        setRecolorButtonBusy(true);

        try {
            const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;
            const fontTagRegex = /<font\b[^>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?[^>]*>/gi;
            syncAllEffectiveColors();

            // Step 1: Build global reverse map (oldColor → characterName) from all [COLORS:] blocks.
            // Later messages overwrite earlier so the most-recent assignment wins.
            const globalColorToName = {};
            for (const msg of chat) {
                const text = msg?.mes || '';
                let m;
                while ((m = colorBlockRegex.exec(text)) !== null) {
                    for (const pair of m[1].split(',')) {
                        const eqIdx = pair.indexOf('=');
                        if (eqIdx === -1) continue;
                        const { name } = parseNameWithNicknames(pair.substring(0, eqIdx).trim());
                        const rawColor = pair.substring(eqIdx + 1).trim();
                        if (name && /^#[0-9a-fA-F]{6}$/.test(rawColor)) {
                            globalColorToName[rawColor.toLowerCase()] = name;
                        }
                    }
                }
            }

            // Step 2: Build current name → newColor lookup from characterColors (including aliases).
            const nameToNewColor = {};
            for (const entry of Object.values(characterColors)) {
                const adjusted = normalizeHexColor(entry.color);
                nameToNewColor[entry.name.toLowerCase()] = adjusted;
                for (const alias of (entry.aliases || [])) {
                    nameToNewColor[alias.toLowerCase()] = adjusted;
                }
            }
            // Include narrator color if set
            if (settings.narratorColor) {
                nameToNewColor['narrator'] = applyThemeReadabilityAndBrightness(settings.narratorColor);
            }

            // Step 3: Process each non-user message
            let recoloredCount = 0;
            const messageEls = document.querySelectorAll('.mes');
            for (let i = 0; i < chat.length; i++) {
                const msg = chat[i];
                if (!msg || msg.is_user) continue;
                const rawText = msg.mes || '';
                if (!rawText) continue;

                // Build per-message local oldColor→name map from this message's [COLORS:] block
                const localColorToName = {};
                let blockMatch;
                const localBlockRegex = /\[COLORS?:(.*?)\]/gis;
                while ((blockMatch = localBlockRegex.exec(rawText)) !== null) {
                    for (const pair of blockMatch[1].split(',')) {
                        const eqIdx = pair.indexOf('=');
                        if (eqIdx === -1) continue;
                        const { name } = parseNameWithNicknames(pair.substring(0, eqIdx).trim());
                        const rawColor = pair.substring(eqIdx + 1).trim();
                        if (name && /^#[0-9a-fA-F]{6}$/.test(rawColor)) {
                            localColorToName[rawColor.toLowerCase()] = name;
                        }
                    }
                }

                // Merge: local overrides global
                const mergedColorToName = { ...globalColorToName, ...localColorToName };

                // Build oldColor → newColor replacement map
                const replacements = {};
                for (const [oldColor, charName] of Object.entries(mergedColorToName)) {
                    const newColor = nameToNewColor[charName.toLowerCase()];
                    if (newColor && normalizeHexColor(oldColor) !== normalizeHexColor(newColor)) {
                        replacements[oldColor] = newColor;
                    }
                }

                if (!Object.keys(replacements).length) continue;

                // Replace <font color=X> tags in raw msg.mes text
                let updated = rawText.replace(fontTagRegex, (match, oldHex) => {
                    const key = oldHex.toLowerCase();
                    if (replacements[key]) {
                        return match.replace(/(\bcolor\s*=\s*["']?)(#[0-9a-fA-F]{6})(["']?)/i, `$1${replacements[key]}$3`);
                    }
                    return match;
                });

                // Update [COLORS:] block colors in raw text
                updated = updated.replace(colorBlockRegex, (fullMatch, pairsStr) => {
                    const newPairs = pairsStr.split(',').map(pair => {
                        const eqIdx = pair.indexOf('=');
                        if (eqIdx === -1) return pair;
                        const namePart = pair.substring(0, eqIdx);
                        const rawColor = pair.substring(eqIdx + 1).trim();
                        const key = rawColor.toLowerCase();
                        if (replacements[key]) return `${namePart}=${replacements[key]}`;
                        return pair;
                    }).join(',');
                    return fullMatch.replace(pairsStr, newPairs);
                });

                if (updated !== rawText) {
                    msg.mes = updated;
                    recoloredCount++;
                }

                // Update DOM font[color] attributes for this message
                const mesEl = messageEls[i];
                if (mesEl) {
                    const fontEls = mesEl.querySelectorAll('font[color]');
                    for (const fontEl of fontEls) {
                        const oldAttr = (fontEl.getAttribute('color') || '').toLowerCase();
                        if (replacements[oldAttr]) {
                            fontEl.setAttribute('color', replacements[oldAttr]);
                        }
                    }
                }
            }

            // Step 4: Persist and reload
            if (recoloredCount > 0) {
                await ctx.saveChat();
                toastr?.info?.(`Recolored ${recoloredCount} message${recoloredCount !== 1 ? 's' : ''}. Reloading chat...`);
                await ctx.reloadCurrentChat();
            } else {
                toastr?.info?.('No messages needed recoloring.');
            }
        } finally {
            isRecoloring = false;
            setRecolorButtonBusy(false);
        }
    }

    function onNewMessage() {
        if (!settings.enabled || !settings.autoScanNewMessages) return;
        setTimeout(() => {
            const ctx = getContext();
            const chat = ctx?.chat || [];
            if (!chat.length) return;
            const lastMsg = chat[chat.length - 1];
            const text = lastMsg?.mes || '';
            const sigId = lastMsg?.id ?? lastMsg?.send_date ?? '';
            const signature = `${chat.length}|${sigId}|${text}`;
            if (signature === lastProcessedMessageSignature) {
                stripColorBlockFromElement(document.querySelector('.mes:last-child .mes_text'));
                return;
            }
            lastProcessedMessageSignature = signature;
            const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;
            let match;
            while ((match = colorBlockRegex.exec(text)) !== null) {
                processColorPairs(match[1]);
            }
            saveData(); updateCharList(); injectPrompt();
            stripColorBlockFromElement(document.querySelector('.mes:last-child .mes_text'));
        }, 600);
    }

    function addCharacter(name, color) {
        if (!name.trim()) return;
        const key = name.trim().toLowerCase();
        const baseColor = normalizeHexColor(color, suggestColorForName(name) || getNextColor());
        characterColors[key] = { color: applyThemeReadabilityAndBrightness(baseColor), baseColor, name: name.trim(), locked: false, aliases: [], style: '', dialogueCount: 0, group: '' };
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function swapColors(key1, key2) {
        const color1 = getBaseColor(characterColors[key1]);
        const color2 = getBaseColor(characterColors[key2]);
        setEntryFromBaseColor(characterColors[key1], color2);
        setEntryFromBaseColor(characterColors[key2], color1);
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    // Phase 5B: Alias chips, Phase 6A: Batch checkboxes, Phase 6B: Group headers, Phase 5D: Harmony on dblclick
    function updateCharList() {
        const list = document.getElementById('dc-char-list'); if (!list) return;
        const entries = getSortedEntries();
        const countEl = document.getElementById('dc-count');
        if (countEl) countEl.textContent = Object.keys(characterColors).length;

        let lastGroup = null;
        list.innerHTML = entries.length ? entries.map(([k, v]) => {
            const safeKey = escapeAttr(k);
            const safeColor = getEntryEffectiveColor(v);
            const pickerColor = getBaseColor(v, safeColor);
            let groupHeader = '';
            if (sortMode === 'group') {
                const g = v.group || '(ungrouped)';
                if (g !== lastGroup) {
                    lastGroup = g;
                    groupHeader = `<div style="font-weight:bold;font-size:0.8em;opacity:0.7;margin-top:6px;padding:2px 4px;border-bottom:1px solid var(--SmartThemeBorderColor);">${escapeHtml(g)}</div>`;
                }
            }
            const aliasChips = (v.aliases || []).map(a =>
                `<span class="dc-alias-chip" style="display:inline-flex;align-items:center;gap:2px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:10px;padding:0 6px;font-size:0.7em;cursor:default;margin:1px;">${escapeHtml(a)}<span class="dc-alias-remove" data-key="${safeKey}" data-alias="${escapeAttr(a)}" style="cursor:pointer;opacity:0.7;margin-left:2px;" title="Remove alias">&times;</span></span>`
            ).join('');
            return groupHeader + `
            <div class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''} ${selectedKeys.has(k) ? 'dc-batch-selected' : ''}" data-key="${safeKey}" style="display:flex;flex-direction:column;gap:2px;margin:3px 0;padding:2px;border-radius:4px;${swapMode === k ? 'background:var(--SmartThemeQuoteColor);' : ''}${selectedKeys.has(k) ? 'outline:2px solid var(--SmartThemeQuoteColor);' : ''}">
                <div style="display:flex;align-items:center;gap:4px;">
                    <input type="checkbox" class="dc-batch-check" data-key="${safeKey}" ${selectedKeys.has(k) ? 'checked' : ''} style="width:10px;height:10px;margin:0;">
                    <span class="dc-color-swatch" style="position:relative;display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
                        <span class="dc-color-dot" style="width:8px;height:8px;border-radius:50%;background:${safeColor};cursor:pointer;"></span>
                        <input type="color" value="${pickerColor}" data-key="${safeKey}" class="dc-color-input" style="width:18px;height:18px;padding:0;border:none;cursor:pointer;">
                    </span>
                    <span style="flex:1;color:${safeColor};font-size:0.85em;" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + escapeHtml(v.aliases.join(', ')) : ''}${v.group ? '\nGroup: ' + escapeHtml(v.group) : ''}">${escapeHtml(v.name)}${v.style ? ` [${v.style[0].toUpperCase()}]` : ''}${getBadge(v.dialogueCount || 0)}</span>
                    <span style="font-size:0.7em;opacity:0.6;">${v.dialogueCount || 0}</span>
                    <button class="dc-lock menu_button" data-key="${safeKey}" style="padding:1px 4px;font-size:0.7em;" title="Lock color">${v.locked ? '🔒' : '🔓'}</button>
                    <button class="dc-swap menu_button" data-key="${safeKey}" style="padding:1px 4px;font-size:0.7em;" title="Swap colors">⇄</button>
                    <button class="dc-style menu_button" data-key="${safeKey}" style="padding:1px 4px;font-size:0.7em;" title="Style">S</button>
                    <button class="dc-alias menu_button" data-key="${safeKey}" style="padding:1px 4px;font-size:0.7em;" title="Add alias">+</button>
                    <button class="dc-group menu_button" data-key="${safeKey}" style="padding:1px 4px;font-size:0.7em;" title="Assign group">G</button>
                    <button class="dc-del menu_button" data-key="${safeKey}" style="padding:1px 4px;font-size:0.7em;">&times;</button>
                </div>
                ${aliasChips ? `<div style="display:flex;flex-wrap:wrap;gap:2px;padding-left:26px;">${aliasChips}</div>` : ''}
            </div>`;
        }).join('') : `<small style="opacity:0.6;">${searchTerm ? 'No matches' : 'No characters'}</small>`;

        applyControlHelpText(list);

        // Color input + double-click for harmony popup
        list.querySelectorAll('.dc-color-input').forEach(i => {
            i.oninput = () => {
                const c = characterColors[i.dataset.key];
                if (!c) return;
                const nextColor = normalizeHexColor(i.value, getBaseColor(c));
                setEntryFromBaseColor(c, nextColor);
                c.aliases?.forEach(a => {
                    const ak = a.toLowerCase();
                    if (characterColors[ak]) setEntryFromBaseColor(characterColors[ak], nextColor);
                });
                saveHistory(); saveData(); injectPrompt(); updateCharList();
            };
            i.onchange = () => {
                if (!settings.autoRecolor) return;
                if (!autoRecolorHintShown) {
                    autoRecolorHintShown = true;
                    toastr?.info?.('Auto-recolor is enabled; color changes will update chat automatically.');
                }
                recolorAllMessages();
            };
            i.ondblclick = (e) => { e.preventDefault(); showHarmonyPopup(i.dataset.key, i); };
        });
        list.querySelectorAll('.dc-color-dot').forEach(dot => {
            dot.onclick = () => { const input = dot.nextElementSibling; if (input?.classList.contains('dc-color-input')) input.click(); };
        });
        list.querySelectorAll('.dc-del').forEach(b => { b.onclick = () => { delete characterColors[b.dataset.key]; selectedKeys.delete(b.dataset.key); saveHistory(); saveData(); injectPrompt(); updateCharList(); }; });
        list.querySelectorAll('.dc-lock').forEach(b => {
            b.onclick = () => {
                const key = b.dataset.key;
                if (!characterColors[key]) return;
                characterColors[key].locked = !characterColors[key].locked;
                saveHistory();
                saveData(); updateCharList();
            };
        });
        list.querySelectorAll('.dc-swap').forEach(b => {
            b.onclick = () => {
                if (!swapMode) { swapMode = b.dataset.key; updateCharList(); toastr?.info?.('Click another character to swap'); }
                else if (swapMode === b.dataset.key) { swapMode = null; updateCharList(); }
                else { swapColors(swapMode, b.dataset.key); swapMode = null; }
            };
        });
        list.querySelectorAll('.dc-style').forEach(b => {
            b.onclick = () => {
                const styles = ['', 'bold', 'italic', 'bold italic'];
                const curr = characterColors[b.dataset.key].style || '';
                characterColors[b.dataset.key].style = styles[(styles.indexOf(curr) + 1) % styles.length];
                saveHistory();
                saveData(); injectPrompt(); updateCharList();
            };
        });
        list.querySelectorAll('.dc-alias').forEach(b => {
            b.onclick = () => {
                const row = b.closest('.dc-char');
                const existing = row.querySelector('.dc-inline-input');
                if (existing) { existing.remove(); return; }
                const inputRow = document.createElement('div');
                inputRow.className = 'dc-inline-input';
                inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
                inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Alias name..." style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Add</button>`;
                row.appendChild(inputRow);
                const inp = inputRow.querySelector('input');
                inp.focus();
                const submit = () => {
                    const alias = inp.value.trim();
                    if (alias) {
                        const aliases = characterColors[b.dataset.key].aliases = characterColors[b.dataset.key].aliases || [];
                        if (!aliases.includes(alias)) {
                            aliases.push(alias);
                            saveHistory();
                            saveData(); injectPrompt(); updateCharList();
                        } else {
                            inputRow.remove();
                        }
                    }
                    else inputRow.remove();
                };
                inputRow.querySelector('button').onclick = submit;
                inp.onkeydown = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') inputRow.remove(); };
            };
        });
        // Phase 5B: Alias chip removal
        list.querySelectorAll('.dc-alias-remove').forEach(b => {
            b.onclick = (e) => {
                e.stopPropagation();
                const key = b.dataset.key;
                const alias = b.dataset.alias;
                if (characterColors[key]?.aliases) {
                    const nextAliases = characterColors[key].aliases.filter(a => a !== alias);
                    if (nextAliases.length !== characterColors[key].aliases.length) {
                        characterColors[key].aliases = nextAliases;
                        saveHistory();
                        saveData(); injectPrompt(); updateCharList();
                    }
                }
            };
        });
        // Phase 6B: Group assignment
        list.querySelectorAll('.dc-group').forEach(b => {
            b.onclick = () => {
                const row = b.closest('.dc-char');
                const existing = row.querySelector('.dc-inline-input');
                if (existing) { existing.remove(); return; }
                const key = b.dataset.key;
                const current = characterColors[key]?.group || '';
                const inputRow = document.createElement('div');
                inputRow.className = 'dc-inline-input';
                inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
                inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Group name..." value="${escapeHtml(current)}" style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Set</button>`;
                row.appendChild(inputRow);
                const inp = inputRow.querySelector('input');
                inp.focus();
                inp.select();
                const submit = () => {
                    const nextGroup = inp.value.trim();
                    if ((characterColors[key]?.group || '') !== nextGroup) {
                        characterColors[key].group = nextGroup;
                        saveHistory();
                        saveData(); updateCharList();
                    } else {
                        inputRow.remove();
                    }
                };
                inputRow.querySelector('button').onclick = submit;
                inp.onkeydown = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') inputRow.remove(); };
            };
        });
        // Phase 6A: Batch selection checkboxes
        list.querySelectorAll('.dc-batch-check').forEach(cb => {
            cb.onchange = () => {
                if (cb.checked) selectedKeys.add(cb.dataset.key);
                else selectedKeys.delete(cb.dataset.key);
                updateBatchBar();
                updateCharList();
            };
        });

        updateBatchBar();
        updateLegend();
    }

    // Phase 6A: Show/hide batch bar based on selection
    function updateBatchBar() {
        const bar = document.getElementById('dc-batch-bar');
        if (!bar) return;
        if (selectedKeys.size > 0) {
            bar.style.display = 'flex';
            bar.style.opacity = '1';
            bar.style.maxHeight = '100px';
        } else {
            bar.style.opacity = '0';
            bar.style.maxHeight = '0';
            setTimeout(() => { if (!selectedKeys.size) bar.style.display = 'none'; }, 150);
        }
    }

    function setControlHelp(element, text) {
        if (!element || !text) return;
        element.title = text;
        element.setAttribute('aria-label', text);
    }

    function applyControlHelpText(root = document) {
        for (const [id, text] of Object.entries(CONTROL_HELP_TEXT)) {
            const element = document.getElementById(id);
            if (element) setControlHelp(element, text);
        }
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        for (const [selector, text] of Object.entries(DYNAMIC_CONTROL_HELP_TEXT)) {
            scope.querySelectorAll(selector).forEach(element => setControlHelp(element, text));
        }
    }

    function getHelpTextByItem(item) {
        if (item.text) return item.text;
        if (item.key) return CONTROL_HELP_TEXT[item.key] || '';
        return '';
    }

    function renderControlHelpPanel() {
        const panel = document.getElementById('dc-help-panel');
        if (!panel) return;
        if (!settings.showControlHelp) {
            panel.style.display = 'none';
            panel.innerHTML = '';
            return;
        }
        const html = CONTROL_HELP_PANEL_GROUPS.map(group => {
            const rows = group.items.map(item => {
                const text = getHelpTextByItem(item);
                if (!text) return '';
                return `<div class="dc-help-item"><span class="dc-help-name">${escapeHtml(item.label)}</span><span class="dc-help-desc">${escapeHtml(text)}</span></div>`;
            }).filter(Boolean).join('');
            if (!rows) return '';
            return `<div class="dc-help-group"><div class="dc-help-group-title">${escapeHtml(group.title)}</div>${rows}</div>`;
        }).filter(Boolean).join('');
        panel.innerHTML = html;
        panel.style.display = html ? 'block' : 'none';
    }

    function autoAssignFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const key = char?.name?.toLowerCase();
            if (key && !characterColors[key]) {
                addCharacter(char.name);
                toastr?.success?.(`Added ${char.name}`);
            }
        } catch { }
    }

    // Phase 1C: Sync UI elements with current settings (deduplicates createUI and CHAT_CHANGED)
    function syncUIWithSettings() {
        const $ = id => document.getElementById(id);
        if ($('dc-enabled')) $('dc-enabled').checked = settings.enabled;
        if ($('dc-highlight')) $('dc-highlight').checked = settings.highlightMode;
        if ($('dc-autoscan')) $('dc-autoscan').checked = settings.autoScanOnLoad !== false;
        if ($('dc-autoscan-new')) $('dc-autoscan-new').checked = settings.autoScanNewMessages !== false;
        if ($('dc-auto-lock')) $('dc-auto-lock').checked = settings.autoLockDetected !== false;
        if ($('dc-auto-recolor')) $('dc-auto-recolor').checked = settings.autoRecolor !== false;
        if ($('dc-auto-brightness')) $('dc-auto-brightness').checked = settings.autoBrightness || false;
        if ($('dc-right-click')) $('dc-right-click').checked = settings.enableRightClick;
        if ($('dc-legend')) $('dc-legend').checked = settings.showLegend;
        if ($('dc-disable-narration')) $('dc-disable-narration').checked = settings.disableNarration !== false;
        if ($('dc-share-global')) $('dc-share-global').checked = settings.shareColorsGlobally || false;
        if ($('dc-css-effects')) $('dc-css-effects').checked = settings.cssEffects || false;
        if ($('dc-llm-palette')) $('dc-llm-palette').checked = settings.llmEnhanceCustomPalettes !== false;
        if ($('dc-theme')) $('dc-theme').value = settings.themeMode;
        if ($('dc-brightness')) { $('dc-brightness').value = settings.brightness || 0; }
        if ($('dc-bright-val')) $('dc-bright-val').textContent = settings.brightness || 0;
        if ($('dc-narrator')) $('dc-narrator').value = settings.narratorColor || '#888888';
        if ($('dc-thought-symbols')) $('dc-thought-symbols').value = settings.thoughtSymbols || '';
        if ($('dc-prompt-depth')) $('dc-prompt-depth').value = settings.promptDepth ?? 4;
        if ($('dc-help-toggle')) $('dc-help-toggle').checked = !!settings.showControlHelp;
        renderControlHelpPanel();
        applyControlHelpText();
        refreshPresetDropdown();
        refreshPaletteDropdown();
    }

    // Phase 6C: Mobile-optimized UI with collapsible <details> sections
    function createUI() {
        if (document.getElementById('dc-ext')) return;
        const html = `
        <div id="dc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>Dialogue Colors</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content" style="padding:10px;display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
                <details class="dc-section" open>
                    <summary style="cursor:pointer;font-weight:bold;margin-bottom:4px;">Display</summary>
                    <div style="display:flex;flex-direction:column;gap:4px;padding-left:4px;">
                        <label class="checkbox_label"><input type="checkbox" id="dc-help-toggle"><span>Show control help panel</span></label>
                        <div id="dc-help-panel" class="dc-help-panel" style="display:none;"></div>
                        <label class="checkbox_label"><input type="checkbox" id="dc-enabled"><span>Enable</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-highlight"><span>Highlight mode</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-legend"><span>Show floating legend</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-css-effects"><span>CSS effects (emotion/magic transforms)</span></label>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Theme:</label><select id="dc-theme" class="text_pole" style="flex:1;"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Palette:</label><select id="dc-palette" class="text_pole" style="flex:1;"></select><button id="dc-gen-palette" class="menu_button" style="padding:2px 6px;font-size:0.8em;" title="Generate custom palette from words">Gen</button><button id="dc-save-palette" class="menu_button" style="padding:2px 6px;font-size:0.8em;" title="Save current colors as custom palette">+</button><button id="dc-del-palette" class="menu_button" style="padding:2px 6px;font-size:0.8em;" title="Delete custom palette">&minus;</button></div>
                        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                            <input type="text" id="dc-palette-name-input" placeholder="Palette name..." class="text_pole" style="flex:1;min-width:110px;padding:3px;">
                            <input type="text" id="dc-palette-notes-input" placeholder="Palette notes (optional)" class="text_pole" style="flex:1;min-width:140px;padding:3px;">
                            <button id="dc-palette-save-inline" class="menu_button" style="padding:2px 6px;font-size:0.8em;" title="Save current colors to named custom palette">Save</button>
                            <button id="dc-palette-generate-inline" class="menu_button" style="padding:2px 6px;font-size:0.8em;" title="Generate custom palette from name and notes">Generate</button>
                        </div>
                        <label class="checkbox_label"><input type="checkbox" id="dc-overwrite-existing"><span>Overwrite existing custom palette</span></label>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Bright:</label><input type="range" id="dc-brightness" min="-100" max="100" value="0" style="flex:1;"><span id="dc-bright-val">0</span></div>
                        <label class="checkbox_label"><input type="checkbox" id="dc-auto-brightness"><span>Auto-brightness on change</span></label>
                    </div>
                </details>
                <details class="dc-section">
                    <summary style="cursor:pointer;font-weight:bold;margin-bottom:4px;">Behavior</summary>
                    <div style="display:flex;flex-direction:column;gap:4px;padding-left:4px;">
                        <label class="checkbox_label"><input type="checkbox" id="dc-autoscan"><span>Auto-scan on chat load</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-autoscan-new"><span>Auto-scan new messages</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-auto-lock"><span>Auto-lock detected characters</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-auto-recolor"><span>Auto-recolor on change</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-right-click"><span>Enable right-click context menu</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-disable-narration"><span>Disable narration coloring</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-share-global"><span>Share colors across all chats</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-llm-palette"><span>Enhance generated palettes with LLM</span></label>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Narr:</label><input type="color" id="dc-narrator" value="#888888" style="width:24px;height:20px;"><button id="dc-narrator-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;"><label style="width:50px;" title="Symbols for inner thoughts (*etc)">Think:</label><input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole" style="width:60px;padding:3px;"><button id="dc-thought-add" class="menu_button" style="padding:2px 6px;font-size:0.8em;">+</button><button id="dc-thought-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                        <div style="display:flex;gap:4px;align-items:center;" title="How many messages from the end to inject the color prompt. Lower = closer to latest message. Try 1-4 if the model ignores colors."><label style="width:50px;">Depth:</label><input type="number" id="dc-prompt-depth" min="0" max="99" value="4" class="text_pole" style="width:60px;padding:3px;"></div>
                    </div>
                </details>
                <details class="dc-section">
                    <summary style="cursor:pointer;font-weight:bold;margin-bottom:4px;">Actions</summary>
                    <div style="display:flex;flex-direction:column;gap:4px;padding-left:4px;">
                        <div style="display:flex;gap:4px;"><button id="dc-scan" class="menu_button" style="flex:1;">Scan</button><button id="dc-clear" class="menu_button" style="flex:1;">Clear</button><button id="dc-stats" class="menu_button" style="flex:1;" title="Dialogue statistics">Stats</button></div>
                        <div style="display:flex;gap:4px;"><button id="dc-recolor" class="menu_button" style="flex:1;" title="Recolor all messages with current color assignments">Recolor</button></div>
                        <div style="display:flex;gap:4px;"><button id="dc-undo" class="menu_button" style="flex:1;">&#8630;</button><button id="dc-redo" class="menu_button" style="flex:1;">&#8631;</button><button id="dc-fix-conflicts" class="menu_button" style="flex:1;" title="Auto-fix color conflicts">Fix</button></div>
                        <div style="display:flex;gap:4px;"><button id="dc-regen" class="menu_button" style="flex:1;" title="Regenerate all colors">Regen</button><button id="dc-flip-theme" class="menu_button" style="flex:1;" title="Flip colors for Dark/Light theme switch">&#9728;/&#127769;</button></div>
                        <hr style="margin:4px 0;opacity:0.15;">
                        <div style="display:flex;gap:4px;align-items:center;"><input type="text" id="dc-preset-name" placeholder="Preset name..." class="text_pole" style="flex:1;padding:3px;"><button id="dc-save-preset" class="menu_button" style="padding:3px 8px;" title="Save preset">Save</button></div>
                        <div style="display:flex;gap:4px;align-items:center;"><select id="dc-preset-select" class="text_pole" style="flex:1;"><option value="">-- Select Preset --</option></select><button id="dc-load-preset" class="menu_button" style="padding:3px 8px;" title="Load preset">Load</button><button id="dc-delete-preset" class="menu_button" style="padding:3px 8px;" title="Delete preset">Del</button></div>
                        <hr style="margin:4px 0;opacity:0.15;">
                        <div style="display:flex;gap:4px;"><button id="dc-export" class="menu_button" style="flex:1;">Export</button><button id="dc-import" class="menu_button" style="flex:1;">Import</button><button id="dc-export-png" class="menu_button" style="flex:1;" title="Export legend as image">PNG</button></div>
                        <div style="display:flex;gap:4px;"><button id="dc-card" class="menu_button" style="flex:1;" title="Add from card">+Card</button><button id="dc-avatar-color" class="menu_button" style="flex:1;" title="Suggest color from avatar">Avatar</button><button id="dc-save-card" class="menu_button" style="flex:1;" title="Save to card">Save&rarr;Card</button><button id="dc-load-card" class="menu_button" style="flex:1;" title="Load from card">Card&rarr;Load</button></div>
                        <hr style="margin:4px 0;opacity:0.15;">
                        <div style="display:flex;gap:4px;"><button id="dc-lock-all" class="menu_button" style="flex:1;" title="Lock all characters">🔒All</button><button id="dc-unlock-all" class="menu_button" style="flex:1;" title="Unlock all characters">🔓All</button><button id="dc-reset" class="menu_button" style="flex:1;" title="Reset to default colors">Reset</button></div>
                        <div style="display:flex;gap:4px;align-items:center;"><button id="dc-del-locked" class="menu_button" style="flex:1;" title="Delete all locked characters">DelLocked</button><button id="dc-del-unlocked" class="menu_button" style="flex:1;" title="Delete all unlocked characters">DelUnlocked</button><button id="dc-del-least" class="menu_button" style="flex:1;" title="Delete characters below dialogue threshold">DelLeast</button><input type="number" id="dc-del-least-threshold" min="0" value="3" class="text_pole" style="width:52px;padding:2px 4px;" title="Minimum dialogues to keep"></div>
                        <div style="display:flex;gap:4px;"><button id="dc-del-dupes" class="menu_button" style="flex:1;" title="Delete duplicate colors, keep highest dialogue count">DelDupes</button></div>
                        <input type="file" id="dc-import-file" accept=".json" style="display:none;">
                    </div>
                </details>
                <details class="dc-section" open>
                    <summary style="cursor:pointer;font-weight:bold;margin-bottom:4px;">Characters</summary>
                    <div style="display:flex;flex-direction:column;gap:4px;padding-left:4px;">
                        <div style="display:flex;gap:4px;"><input type="text" id="dc-search" placeholder="Search characters..." class="text_pole" style="flex:1;padding:3px;"></div>
                        <div style="display:flex;gap:4px;align-items:center;"><label>Sort:</label><select id="dc-sort" class="text_pole" style="flex:1;"><option value="name">Name</option><option value="count">Dialogue Count</option><option value="group">Group</option></select></div>
                        <div style="display:flex;gap:4px;"><input type="text" id="dc-add-name" placeholder="Add character..." class="text_pole" style="flex:1;padding:3px;"><button id="dc-add-btn" class="menu_button" style="padding:3px 8px;">+</button></div>
                        <div id="dc-batch-bar" style="display:none;gap:4px;flex-wrap:wrap;padding:4px;background:var(--SmartThemeBlurTintColor);border-radius:4px;">
                            <button id="dc-batch-all" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Select All</button>
                            <button id="dc-batch-none" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Deselect All</button>
                            <button id="dc-batch-del" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Delete</button>
                            <button id="dc-batch-lock" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Lock</button>
                            <button id="dc-batch-unlock" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Unlock</button>
                            <select id="dc-batch-style-select" class="text_pole" style="padding:1px 4px;font-size:0.8em;min-width:92px;">
                                <option value="">Style: none</option>
                                <option value="bold">Style: bold</option>
                                <option value="italic">Style: italic</option>
                                <option value="bold italic">Style: bold italic</option>
                            </select>
                            <button id="dc-batch-style-apply" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Apply Style</button>
                        </div>
                        <small>Characters: <span id="dc-count">0</span> (⭐=50+, 💎=100+)</small>
                        <div id="dc-char-list" style="max-height:300px;overflow-y:auto;"></div>
                    </div>
                </details>
                <hr style="margin:2px 0;opacity:0.2;">
                <small>Preview:</small>
                <div id="dc-prompt-preview" style="font-size:0.75em;max-height:40px;overflow-y:auto;padding:3px;background:var(--SmartThemeBlurTintColor);border-radius:3px;"></div>
            </div>
        </div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

        const $ = id => document.getElementById(id);

        // Use syncUIWithSettings for initial checkbox/select state
        syncUIWithSettings();

        // Wire up event handlers
        $('dc-enabled').onchange = e => { settings.enabled = e.target.checked; saveData(); injectPrompt(); };
        $('dc-highlight').onchange = e => { settings.highlightMode = e.target.checked; saveData(); injectPrompt(); };
        $('dc-autoscan').onchange = e => { settings.autoScanOnLoad = e.target.checked; saveData(); };
        $('dc-autoscan-new').onchange = e => { settings.autoScanNewMessages = e.target.checked; saveData(); };
        $('dc-auto-lock').onchange = e => { settings.autoLockDetected = e.target.checked; saveData(); };
        $('dc-auto-recolor').onchange = e => { settings.autoRecolor = e.target.checked; saveData(); };
        $('dc-auto-brightness').onchange = e => { settings.autoBrightness = e.target.checked; saveData(); };
        $('dc-right-click').onchange = e => { settings.enableRightClick = e.target.checked; saveData(); };
        $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
        $('dc-disable-narration').onchange = e => { settings.disableNarration = e.target.checked; saveData(); injectPrompt(); };
        $('dc-share-global').onchange = e => { settings.shareColorsGlobally = e.target.checked; saveData(); loadData(); updateCharList(); injectPrompt(); };
        $('dc-css-effects').onchange = e => { settings.cssEffects = e.target.checked; saveData(); injectPrompt(); };
        $('dc-llm-palette').onchange = e => { settings.llmEnhanceCustomPalettes = e.target.checked; saveData(); };
        $('dc-theme').onchange = e => { settings.themeMode = e.target.value; invalidateThemeCache(); syncAllEffectiveColors(); saveData(); updateCharList(); injectPrompt(); if (settings.autoRecolor) recolorAllMessages(); };
        $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); injectPrompt(); };
        $('dc-brightness').oninput = e => { settings.brightness = parseInt(e.target.value); $('dc-bright-val').textContent = e.target.value; invalidateThemeCache(); syncAllEffectiveColors(); saveData(); updateCharList(); injectPrompt(); };
        $('dc-brightness').onchange = () => { if (settings.autoBrightness) recolorAllMessages(); };
        $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); };
        $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); };
        $('dc-thought-symbols').oninput = e => { settings.thoughtSymbols = e.target.value; saveData(); injectPrompt(); };
        $('dc-thought-add').onclick = () => { const s = prompt('Add thought symbol (e.g., *, 「, 『):'); if (s?.trim()) { settings.thoughtSymbols = (settings.thoughtSymbols || '') + s.trim(); $('dc-thought-symbols').value = settings.thoughtSymbols; saveData(); injectPrompt(); } };
        $('dc-thought-clear').onclick = () => { settings.thoughtSymbols = ''; $('dc-thought-symbols').value = ''; saveData(); injectPrompt(); };
        $('dc-prompt-depth').oninput = e => { settings.promptDepth = parseInt(e.target.value) || 0; saveData(); injectPrompt(); };
        $('dc-help-toggle').onchange = e => { settings.showControlHelp = e.target.checked; saveData(); renderControlHelpPanel(); };
        $('dc-scan').onclick = scanAllMessages;
        $('dc-clear').onclick = () => {
            const count = Object.keys(characterColors).length;
            if (!count) { toastr?.info?.('No characters to clear'); return; }
            characterColors = {};
            selectedKeys.clear();
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            showUndoToast(`Cleared ${count} character${count !== 1 ? 's' : ''}.`);
        };
        $('dc-stats').onclick = showStatsPopup;
        $('dc-recolor').onclick = () => {
            if (confirm('Recolor all messages with current color assignments?')) {
                recolorAllMessages();
            }
        };
        $('dc-fix-conflicts').onclick = autoResolveConflicts;
        $('dc-regen').onclick = regenerateAllColors;
        $('dc-flip-theme').onclick = flipColorsForTheme;
        $('dc-save-preset').onclick = saveColorPreset;
        $('dc-load-preset').onclick = loadColorPreset;
        $('dc-delete-preset').onclick = deleteColorPreset;
        $('dc-gen-palette').onclick = async () => { await generateCustomPaletteFromWords(); };
        $('dc-save-palette').onclick = saveCustomPalette;
        $('dc-palette-generate-inline').onclick = async () => { await generateCustomPaletteFromWords(); };
        $('dc-palette-save-inline').onclick = saveCustomPalette;
        $('dc-palette-name-input').onkeypress = e => { if (e.key === 'Enter') $('dc-palette-generate-inline').click(); };
        $('dc-palette-notes-input').onkeypress = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('dc-palette-generate-inline').click(); };
        $('dc-del-palette').onclick = deleteCustomPalette;
        $('dc-card').onclick = autoAssignFromCard;
        $('dc-avatar-color').onclick = async () => {
            try {
                const ctx = getContext();
                const char = ctx?.characters?.[ctx?.characterId];
                if (!char?.avatar) { toastr?.info?.('No avatar found'); return; }
                const avatarUrl = `/characters/${encodeURIComponent(char.avatar)}`;
                const color = await extractAvatarColor(avatarUrl);
                if (color) {
                    const key = char.name.toLowerCase();
                    if (characterColors[key]) {
                        setEntryFromBaseColor(characterColors[key], color);
                    } else {
                        characterColors[key] = { color: applyThemeReadabilityAndBrightness(color), baseColor: normalizeHexColor(color), name: char.name, locked: false, aliases: [], style: '', dialogueCount: 0, group: '' };
                    }
                    saveHistory(); saveData(); updateCharList(); injectPrompt();
                    toastr?.success?.(`Set ${char.name} to ${color}`);
                } else {
                    toastr?.error?.('Could not extract color');
                }
            } catch (e) { toastr?.error?.('Failed to extract avatar color'); }
        };
        $('dc-save-card').onclick = saveToCard;
        $('dc-load-card').onclick = loadFromCard;
        $('dc-undo').onclick = undo; $('dc-redo').onclick = redo;
        $('dc-export').onclick = exportColors;
        $('dc-import').onclick = () => $('dc-import-file').click();
        $('dc-export-png').onclick = exportLegendPng;
        $('dc-import-file').onchange = e => { if (e.target.files[0]) importColors(e.target.files[0]); };
        $('dc-del-locked').onclick = () => {
            let count = 0;
            Object.keys(characterColors).forEach(k => { if (characterColors[k].locked) { delete characterColors[k]; selectedKeys.delete(k); count++; } });
            if (!count) { toastr?.info?.('No locked characters to delete'); return; }
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            showUndoToast(`Deleted ${count} locked character${count !== 1 ? 's' : ''}.`);
        };
        $('dc-del-unlocked').onclick = () => {
            let count = 0;
            Object.keys(characterColors).forEach(k => { if (!characterColors[k].locked) { delete characterColors[k]; selectedKeys.delete(k); count++; } });
            if (!count) { toastr?.info?.('No unlocked characters to delete'); return; }
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            showUndoToast(`Deleted ${count} unlocked character${count !== 1 ? 's' : ''}.`);
        };
        $('dc-del-least').onclick = () => {
            const thresholdField = $('dc-del-least-threshold');
            const min = parseInt(thresholdField?.value || '3', 10);
            if (isNaN(min) || min < 0) { toastr?.warning?.('Invalid threshold'); return; }
            let count = 0;
            Object.keys(characterColors).forEach(k => {
                if ((characterColors[k].dialogueCount || 0) < min) {
                    delete characterColors[k]; selectedKeys.delete(k); count++;
                }
            });
            if (!count) { toastr?.info?.(`No characters below ${min} dialogues`); return; }
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            showUndoToast(`Deleted ${count} character${count !== 1 ? 's' : ''} with <${min} dialogues.`);
        };
        $('dc-del-dupes').onclick = () => {
            const colorGroups = {};
            Object.entries(characterColors).forEach(([k, v]) => {
                const c = getEntryEffectiveColor(v).toLowerCase();
                if (!colorGroups[c]) colorGroups[c] = [];
                colorGroups[c].push({ key: k, count: v.dialogueCount || 0 });
            });
            let deleted = 0;
            Object.values(colorGroups).forEach(group => {
                if (group.length > 1) {
                    group.sort((a, b) => b.count - a.count);
                    group.slice(1).forEach(({ key }) => {
                        delete characterColors[key]; selectedKeys.delete(key); deleted++;
                    });
                }
            });
            if (!deleted) { toastr?.info?.('No duplicate colors found'); return; }
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            showUndoToast(`Deleted ${deleted} duplicate-color character${deleted !== 1 ? 's' : ''}.`);
        };
        $('dc-lock-all').onclick = () => {
            let count = 0;
            Object.keys(characterColors).forEach(k => {
                if (!characterColors[k].locked) {
                    characterColors[k].locked = true;
                    count++;
                }
            });
            if (count) saveHistory();
            saveData(); updateCharList(); toastr?.info?.(`Locked ${count} characters`);
        };
        $('dc-unlock-all').onclick = () => {
            let count = 0;
            Object.keys(characterColors).forEach(k => {
                if (characterColors[k].locked) {
                    characterColors[k].locked = false;
                    count++;
                }
            });
            if (count) saveHistory();
            saveData(); updateCharList(); toastr?.info?.(`Unlocked ${count} characters`);
        };
        $('dc-reset').onclick = () => {
            if (!confirm('Reset all colors?')) return;
            let changed = 0;
            Object.values(characterColors).forEach(c => {
                if (!c.locked) {
                    setEntryFromBaseColor(c, getNextColor());
                    changed++;
                }
            });
            if (!changed) { toastr?.info?.('No unlocked colors to reset'); return; }
            saveHistory(); saveData(); updateCharList(); injectPrompt();
            showUndoToast(`Reset ${changed} unlocked color${changed !== 1 ? 's' : ''}.`);
        };
        $('dc-search').oninput = e => { searchTerm = e.target.value; updateCharList(); };
        $('dc-sort').onchange = e => { sortMode = e.target.value; updateCharList(); };
        $('dc-add-btn').onclick = () => { addCharacter($('dc-add-name').value); $('dc-add-name').value = ''; };
        $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };

        // Phase 6A: Batch operations
        $('dc-batch-all').onclick = () => { Object.keys(characterColors).forEach(k => selectedKeys.add(k)); updateCharList(); };
        $('dc-batch-none').onclick = () => { selectedKeys.clear(); updateCharList(); };
        $('dc-batch-del').onclick = () => {
            if (!selectedKeys.size) return;
            const count = selectedKeys.size;
            selectedKeys.forEach(k => delete characterColors[k]);
            selectedKeys.clear();
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            showUndoToast(`Deleted ${count} selected character${count !== 1 ? 's' : ''}.`);
        };
        $('dc-batch-lock').onclick = () => {
            let changed = false;
            selectedKeys.forEach(k => {
                if (characterColors[k] && !characterColors[k].locked) {
                    characterColors[k].locked = true;
                    changed = true;
                }
            });
            if (changed) saveHistory();
            saveData(); updateCharList(); toastr?.info?.('Locked selected characters');
        };
        $('dc-batch-unlock').onclick = () => {
            let changed = false;
            selectedKeys.forEach(k => {
                if (characterColors[k] && characterColors[k].locked) {
                    characterColors[k].locked = false;
                    changed = true;
                }
            });
            if (changed) saveHistory();
            saveData(); updateCharList(); toastr?.info?.('Unlocked selected characters');
        };
        $('dc-batch-style-apply').onclick = () => {
            if (!selectedKeys.size) { toastr?.info?.('Select at least one character first'); return; }
            const validStyle = $('dc-batch-style-select')?.value || '';
            let changed = false;
            selectedKeys.forEach(k => {
                if (characterColors[k] && characterColors[k].style !== validStyle) {
                    characterColors[k].style = validStyle;
                    changed = true;
                }
            });
            if (!changed) { toastr?.info?.('Selected characters already use that style'); return; }
            saveHistory();
            saveData(); injectPrompt(); updateCharList();
        };

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); redo(); }
        });

        applyControlHelpText();
        updateCharList();
        injectPrompt();
    }

    globalThis.DialogueColorsInterceptor = async function (chat, contextSize, abort, type) { if (type !== 'quiet' && settings.enabled) injectPrompt(); };

    function init() {
        loadData();
        setTimeout(() => ensureRegexScript(), 1000);
        setupContextMenu();

        // Phase 6C: Inject mobile CSS for larger touch targets
        const mobileStyle = document.createElement('style');
        mobileStyle.textContent = `
            @media (max-width: 768px) {
                #dc-ext .menu_button { min-height: 36px; min-width: 36px; font-size: 0.85em; }
                #dc-ext input[type="checkbox"] { width: 18px; height: 18px; }
                #dc-ext .dc-char .menu_button { min-height: 30px; min-width: 30px; }
                #dc-ext input[type="color"] { width: 28px !important; height: 28px !important; }
                #dc-ext .dc-batch-check { width: 18px !important; height: 18px !important; }
                #dc-ext details summary { padding: 8px 4px; }
                #dc-harmony-popup { flex-wrap: wrap; max-width: 200px; }
                #dc-harmony-popup .dc-harmony-swatch { width: 32px !important; height: 32px !important; }
            }
        `;
        document.head.appendChild(mobileStyle);

        let waitAttempts = 0;
        const waitUI = setInterval(() => {
            waitAttempts++;
            if (document.getElementById('extensions_settings')) {
                clearInterval(waitUI);
                createUI();
                clearDomCache();
                injectPrompt();
            } else if (waitAttempts > 60) {
                clearInterval(waitUI);
            }
        }, 500);
    }

    setTimeout(init, 100);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => injectPrompt());
    eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearDomCache();
        const currentCharKey = getCharKey();
        if (currentCharKey !== lastCharKey) {
            loadData();
            if (!Object.keys(characterColors).length) tryLoadFromCard();
            lastCharKey = currentCharKey;
            lastProcessedMessageSignature = '';
            syncUIWithSettings();
        }
        updateCharList();
        injectPrompt();
        stripColorBlocksFromDisplay();
        if (settings.autoScanOnLoad !== false && !Object.keys(characterColors).length) {
            setTimeout(() => {
                if (document.querySelectorAll('.mes').length) scanAllMessages();
                stripColorBlocksFromDisplay();
            }, 1000);
        }
    });
})();
