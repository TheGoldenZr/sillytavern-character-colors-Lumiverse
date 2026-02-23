(async function () {
    'use strict';

    const { extension_settings, saveSettingsDebounced, getContext } = await import('../../../extensions.js');
    const { eventSource, event_types, setExtensionPrompt, saveCharacterDebounced, getCharacters } = await import('../../../../script.js');

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

    // Optimized color distance calculation
    function colorDistance(color1, color2) {
        const [h1, , l1] = hexToHsl(color1);
        const [h2, , l2] = hexToHsl(color2);
        const hDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
        return hDiff < 25 && Math.abs(l1 - l2) < 15;
    }

    const MODULE_NAME = 'dialogue-colors';
    let characterColors = {};
    let colorHistory = [];
    let historyIndex = -1;
    let swapMode = null;
    let sortMode = 'name';
    let searchTerm = '';
    let settings = { enabled: true, themeMode: 'auto', narratorColor: '', colorTheme: 'pastel', brightness: 0, highlightMode: false, autoScanOnLoad: true, showLegend: false, thoughtSymbols: '*', disableNarration: true, shareColorsGlobally: false, cssEffects: false, autoScanNewMessages: true, autoLockDetected: true, enableRightClick: false };
    let lastCharKey = null;
    // Phase 6A: Batch selection state
    let selectedKeys = new Set();
    // Phase 3A: Legend event listener cleanup
    let legendListeners = null;

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
    let cachedIsDark = null;
    let injectDebouncedTimer = null;

    function hslToHex(h, s, l) {
        l = Math.max(0, Math.min(100, l + settings.brightness));
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

    // Phase 5C: Handle custom palettes in getNextColor
    function getNextColor() {
        if (settings.colorTheme?.startsWith('custom:')) {
            const paletteName = settings.colorTheme.slice(7);
            const customs = getCustomPalettes();
            const palette = customs[paletteName];
            if (palette) {
                const usedColors = Object.values(characterColors).map(c => c.color);
                for (const color of palette) {
                    if (!usedColors.includes(color)) return color;
                }
                const base = palette[Math.floor(Math.random() * palette.length)];
                const [h, s, l] = hexToHsl(base);
                return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, l);
            }
        }
        const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel;
        const usedColors = Object.values(characterColors).map(c => c.color);
        if (cachedIsDark === null) {
            const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
            cachedIsDark = mode === 'dark';
        }
        const isDark = cachedIsDark;
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
        const hslCache = colors.map(([, v]) => ({ name: v.name, hsl: hexToHsl(v.color) }));
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
                char.color = suggestColorForName(char.name) || getNextColor();
            }
        }
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.('Colors regenerated');
    }

    // Phase 4B: Improved conflict resolution feedback listing pairs
    function autoResolveConflicts() {
        const conflicts = checkColorConflicts();
        if (!conflicts.length) { toastr?.info?.('No conflicts found'); return; }
        const fixedPairs = [];
        conflicts.forEach(([name1, name2]) => {
            const key1 = name1.toLowerCase(), key2 = name2.toLowerCase();
            if (characterColors[key1] && !characterColors[key1].locked) {
                characterColors[key1].color = getNextColor();
                fixedPairs.push(`${name1} & ${name2} (changed ${name1})`);
            } else if (characterColors[key2] && !characterColors[key2].locked) {
                characterColors[key2].color = getNextColor();
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
            const [h, s, l] = hexToHsl(char.color);
            const newL = 100 - l;
            const clampedL = Math.max(25, Math.min(85, newL));
            char.color = hslToHex(h, s, clampedL);
        }
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.('Colors flipped for theme switch');
    }

    // Phase 5A: Preset management with dropdown UI
    function saveColorPreset() {
        const nameInput = document.getElementById('dc-preset-name');
        const name = nameInput?.value?.trim();
        if (!name) { toastr?.warning?.('Enter a preset name'); return; }
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        presets[name] = Object.entries(characterColors).map(([, v]) => ({ name: v.name, color: v.color, style: v.style, aliases: v.aliases || [], group: v.group || '', locked: v.locked || false }));
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
        for (const p of presetData) {
            const key = p.name.toLowerCase();
            if (characterColors[key]) {
                characterColors[key].color = p.color;
                characterColors[key].style = p.style || '';
            } else {
                characterColors[key] = { color: p.color, name: p.name, locked: false, aliases: [], style: p.style || '', dialogueCount: 0, group: '' };
            }
        }
        saveHistory(); saveData(); updateCharList(); injectPrompt();
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
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        const names = Object.keys(presets);
        select.innerHTML = '<option value="">-- Select Preset --</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    // Phase 5C: Custom palettes
    function getCustomPalettes() {
        try { return JSON.parse(localStorage.getItem('dc_custom_palettes') || '{}'); } catch { return {}; }
    }

    function saveCustomPalette() {
        const name = prompt('Custom palette name:');
        if (!name?.trim()) return;
        const colors = Object.values(characterColors).map(c => c.color);
        if (!colors.length) { toastr?.warning?.('No characters to save palette from'); return; }
        const customs = getCustomPalettes();
        customs[name.trim()] = colors;
        localStorage.setItem('dc_custom_palettes', JSON.stringify(customs));
        refreshPaletteDropdown();
        toastr?.success?.(`Custom palette "${name.trim()}" saved`);
    }

    function deleteCustomPalette() {
        const select = document.getElementById('dc-palette');
        if (!select?.value?.startsWith('custom:')) { toastr?.warning?.('Select a custom palette first'); return; }
        const paletteName = select.value.slice(7);
        const customs = getCustomPalettes();
        delete customs[paletteName];
        localStorage.setItem('dc_custom_palettes', JSON.stringify(customs));
        settings.colorTheme = 'pastel';
        saveData();
        refreshPaletteDropdown();
        toastr?.success?.(`Custom palette "${paletteName}" deleted`);
    }

    function refreshPaletteDropdown() {
        const select = document.getElementById('dc-palette');
        if (!select) return;
        const builtinOptions = Object.keys(COLOR_THEMES).map(k => `<option value="${k}">${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('');
        const customs = getCustomPalettes();
        const customNames = Object.keys(customs);
        const customOptions = customNames.length ? `<optgroup label="Custom">${customNames.map(n => `<option value="custom:${n}">${n}</option>`).join('')}</optgroup>` : '';
        select.innerHTML = builtinOptions + customOptions;
        select.value = settings.colorTheme;
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
        const suggestions = getHarmonySuggestions(char.color);
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
                char.color = swatch.dataset.color;
                saveHistory(); saveData(); updateCharList(); injectPrompt();
                popup.remove();
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
        if (cachedTheme) return cachedTheme;
        const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
        cachedTheme = m && (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000 < 128 ? 'dark' : 'light';
        return cachedTheme;
    }
    function invalidateThemeCache() { cachedTheme = null; cachedIsDark = null; }

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
            ctx.beginPath();
            ctx.arc(padding + dotSize / 2, y, dotSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = v.color;
            ctx.fill();
            ctx.fillStyle = v.color;
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
            const color = fontTag.getAttribute('color');
            const text = fontTag.textContent.substring(0, 30) + (fontTag.textContent.length > 30 ? '...' : '');
            const menu = document.createElement('div');
            menu.id = 'dc-context-menu';
            const x = e.clientX || e.touches?.[0]?.clientX || 100;
            const y = e.clientY || e.touches?.[0]?.clientY || 100;
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
                const newColor = colorInput.value;
                if (name) {
                    const key = name.toLowerCase();
                    if (characterColors[key]) {
                        characterColors[key].color = newColor;
                    } else {
                        characterColors[key] = { color: newColor, name, locked: false, aliases: [], style: '', dialogueCount: 1, group: '' };
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
            if (d?.colors) { characterColors = d.colors; loaded = true; }
            if (d?.settings) Object.assign(settings, d.settings);
        } catch { }
        if (!loaded) {
            const legacyKey = getLegacyStorageKey();
            if (legacyKey !== primaryKey) {
                try {
                    const d = JSON.parse(localStorage.getItem(legacyKey));
                    if (d?.colors) { characterColors = d.colors; loaded = true; }
                    if (d?.settings) Object.assign(settings, d.settings);
                } catch { }
            }
        }
        applyGlobal(g);
        colorHistory = [JSON.stringify(characterColors)]; historyIndex = 0;
    }

    function exportColors() {
        const blob = new Blob([JSON.stringify({ colors: characterColors, settings }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function importColors(file) {
        const reader = new FileReader();
        reader.onload = e => { try { const d = JSON.parse(e.target.result); if (d.colors) characterColors = d.colors; if (d.settings) Object.assign(settings, d.settings); saveHistory(); saveData(); updateCharList(); injectPrompt(); toastr?.success?.('Imported!'); } catch { toastr?.error?.('Invalid file'); } };
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

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark'
            ? 'IMPORTANT: Use LIGHT/BRIGHT colors only (high luminance) - pastels, light pinks, light blues, light greens, etc. NEVER use dark colors like brown, maroon, navy, dark green, or any color that would be hard to read on a dark background.'
            : 'IMPORTANT: Use DARK/DEEP colors only (low luminance) - burgundy, navy, forest green, dark purple, etc. NEVER use light colors like pastel pink, light yellow, cream, or any color that would be hard to read on a light background.';
        const colorList = Object.entries(characterColors).filter(([, v]) => v.locked && v.color).map(([, v]) => `${v.name}=${v.color}${v.style ? ` (${v.style})` : ''}`).join(', ');
        const aliases = Object.entries(characterColors).filter(([, v]) => v.aliases?.length).map(([, v]) => `${v.name}/${v.aliases.join('/')}`).join('; ');
        let thoughts = '';
        if (settings.thoughtSymbols) {
            thoughts = ` Inner thoughts wrapped in ${settings.thoughtSymbols} must be fully enclosed in <font color=...> tags using the current speaker's color.`;
        }
        const narratorRule = settings.disableNarration ? '' : (settings.narratorColor ? `Narrator: ${settings.narratorColor}.` : '');
        const narratorInBlock = settings.disableNarration ? '' : ' Include Narrator=#RRGGBB if narration is used.';
        const cssEffectsRule = settings.cssEffects ? ` For intense emotion/magic/distortion, use CSS transforms: chaos=rotate(2deg) skew(5deg), magic=scale(1.2), unease=skew(-10deg), rage=uppercase, whispers=lowercase. Wrap in <span style='transform:X; display:inline-block; background:transparent;'>text</span>.` : '';
        return `[Font Color Rule: Wrap dialogue in <font color=#RRGGBB> tags. ${themeHint} ${colorList ? `LOCKED: ${colorList}.` : ''} ${aliases ? `ALIASES: ${aliases}.` : ''} ${narratorRule} ${thoughts} ${settings.highlightMode ? 'Also add background highlight.' : ''}${cssEffectsRule} Assign unique colors to new characters. At the very END of your response, on its own line, add: [COLORS:Name=#RRGGBB,Name2=#RRGGBB] listing ALL characters who spoke. If a character uses a different name (username, nickname, alias), include it in parentheses: Name(Username)=#RRGGBB.${narratorInBlock} This will be auto-removed.]`;
    }

    function buildColoredPromptPreview() {
        if (!settings.enabled) return '<span style="opacity:0.5">(disabled)</span>';
        const entries = Object.entries(characterColors);
        if (!entries.length) return '<span style="opacity:0.5">(no characters)</span>';
        return entries.map(([, v]) => `<span style="color:${v.color}">${escapeHtml(v.name)}</span>`).join(', ');
    }

    function injectPrompt() {
        if (injectDebouncedTimer) clearTimeout(injectDebouncedTimer);
        injectDebouncedTimer = setTimeout(() => {
            setExtensionPrompt(MODULE_NAME, settings.enabled ? buildPromptInstruction() : '', 1, 0);
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
            const top = savedPos.top || 60;
            const left = savedPos.left;
            const right = savedPos.right || 10;

            legend.style.cssText = `position:fixed;top:${top}px;${left !== undefined ? `left:${left}px;` : `right:${right}px;`}background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:9999;font-size:0.8em;max-width:150px;max-height:60vh;overflow-y:auto;display:none;cursor:move;user-select:none;`;

            let isDragging = false;
            let startX, startY, startLeft, startTop;

            const onMouseDown = (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                isDragging = true;
                const rect = legend.getBoundingClientRect();
                startX = e.clientX || e.touches?.[0]?.clientX;
                startY = e.clientY || e.touches?.[0]?.clientY;
                startLeft = rect.left;
                startTop = rect.top;
                legend.style.right = 'auto';
                legend.style.left = startLeft + 'px';
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const clientX = e.clientX || e.touches?.[0]?.clientX;
                const clientY = e.clientY || e.touches?.[0]?.clientY;
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
            entries.map(([, v]) => `<div style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${v.color};"></span><span style="color:${v.color}">${escapeHtml(v.name)}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount || 0}</span></div>`).join('');
        legend.style.display = settings.showLegend ? 'block' : 'none';
    }

    function getDialogueStats() {
        const entries = Object.entries(characterColors);
        const total = entries.reduce((s, [, v]) => s + (v.dialogueCount || 0), 0);
        return entries.map(([, v]) => ({ name: v.name, count: v.dialogueCount || 0, pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0, color: v.color })).sort((a, b) => b.count - a.count);
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
            char.data.extensions.dialogueColors = { colors: characterColors, settings };
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
                    characterColors = data.colors;
                    if (data.settings) Object.assign(settings, data.settings);
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
                characterColors = data.colors;
                if (data.settings) Object.assign(settings, data.settings);
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
            const color = pair.substring(eqIdx + 1).trim();
            if (!name || !color || !/^#[a-fA-F0-9]{6}$/i.test(color)) continue;
            const key = name.toLowerCase();
            if (characterColors[key]) {
                characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1;
                if (!characterColors[key].locked) characterColors[key].color = color;
            } else {
                characterColors[key] = { color, name, locked: settings.autoLockDetected !== false, aliases: [], style: '', dialogueCount: 1, group: '' };
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
        // Remove blocks from innerHTML using the same regex
        const before = mesText.innerHTML;
        const cleaned = before.replace(/\[COLORS?:.*?\]/gis, '');
        if (cleaned !== before) mesText.innerHTML = cleaned;
        return foundNew;
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
        const conflicts = checkColorConflicts();
        if (conflicts.length) toastr?.warning?.(`Similar: ${conflicts.slice(0, 3).map(c => c.join(' & ')).join(', ')}`);
        toastr?.info?.(`Found ${Object.keys(characterColors).length} characters`);
    }

    function onNewMessage() {
        if (!settings.enabled || !settings.autoScanNewMessages) return;
        setTimeout(() => {
            const ctx = getContext();
            const chat = ctx?.chat || [];
            if (!chat.length) return;
            const lastMsg = chat[chat.length - 1];
            const text = lastMsg?.mes || '';
            const colorBlockRegex = /\[COLORS?:(.*?)\]/gis;
            let match;
            while ((match = colorBlockRegex.exec(text)) !== null) {
                processColorPairs(match[1]);
            }
            saveData(); updateCharList(); injectPrompt();
        }, 600);
    }

    function addCharacter(name, color) {
        if (!name.trim()) return;
        const key = name.trim().toLowerCase();
        const suggested = color || suggestColorForName(name) || getNextColor();
        characterColors[key] = { color: suggested, name: name.trim(), locked: false, aliases: [], style: '', dialogueCount: 0, group: '' };
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function swapColors(key1, key2) {
        const tmp = characterColors[key1].color;
        characterColors[key1].color = characterColors[key2].color;
        characterColors[key2].color = tmp;
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function colorThoughts(element) {
        // Disabled - let the AI handle thought coloring via prompt instruction
    }

    // Phase 5B: Alias chips, Phase 6A: Batch checkboxes, Phase 6B: Group headers, Phase 5D: Harmony on dblclick
    function updateCharList() {
        const list = document.getElementById('dc-char-list'); if (!list) return;
        const entries = getSortedEntries();
        const countEl = document.getElementById('dc-count');
        if (countEl) countEl.textContent = Object.keys(characterColors).length;

        let lastGroup = null;
        list.innerHTML = entries.length ? entries.map(([k, v]) => {
            let groupHeader = '';
            if (sortMode === 'group') {
                const g = v.group || '(ungrouped)';
                if (g !== lastGroup) {
                    lastGroup = g;
                    groupHeader = `<div style="font-weight:bold;font-size:0.8em;opacity:0.7;margin-top:6px;padding:2px 4px;border-bottom:1px solid var(--SmartThemeBorderColor);">${escapeHtml(g)}</div>`;
                }
            }
            const aliasChips = (v.aliases || []).map(a =>
                `<span class="dc-alias-chip" style="display:inline-flex;align-items:center;gap:2px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:10px;padding:0 6px;font-size:0.7em;cursor:default;margin:1px;">${escapeHtml(a)}<span class="dc-alias-remove" data-key="${k}" data-alias="${escapeHtml(a)}" style="cursor:pointer;opacity:0.7;margin-left:2px;" title="Remove alias">&times;</span></span>`
            ).join('');
            return groupHeader + `
            <div class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''} ${selectedKeys.has(k) ? 'dc-batch-selected' : ''}" data-key="${k}" style="display:flex;flex-direction:column;gap:2px;margin:3px 0;padding:2px;border-radius:4px;${swapMode === k ? 'background:var(--SmartThemeQuoteColor);' : ''}${selectedKeys.has(k) ? 'outline:2px solid var(--SmartThemeQuoteColor);' : ''}">
                <div style="display:flex;align-items:center;gap:4px;">
                    <input type="checkbox" class="dc-batch-check" data-key="${k}" ${selectedKeys.has(k) ? 'checked' : ''} style="width:10px;height:10px;margin:0;">
                    <span class="dc-color-dot" style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0;cursor:pointer;"></span>
                    <input type="color" value="${v.color}" data-key="${k}" class="dc-color-input" style="width:18px;height:18px;padding:0;border:none;cursor:pointer;">
                    <span style="flex:1;color:${v.color};font-size:0.85em;" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + escapeHtml(v.aliases.join(', ')) : ''}${v.group ? '\nGroup: ' + escapeHtml(v.group) : ''}">${escapeHtml(v.name)}${v.style ? ` [${v.style[0].toUpperCase()}]` : ''}${getBadge(v.dialogueCount || 0)}</span>
                    <span style="font-size:0.7em;opacity:0.6;">${v.dialogueCount || 0}</span>
                    <button class="dc-lock menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Lock color">${v.locked ? '🔒' : '🔓'}</button>
                    <button class="dc-swap menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Swap colors">⇄</button>
                    <button class="dc-style menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Style">S</button>
                    <button class="dc-alias menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Add alias">+</button>
                    <button class="dc-group menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Assign group">G</button>
                    <button class="dc-del menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;">&times;</button>
                </div>
                ${aliasChips ? `<div style="display:flex;flex-wrap:wrap;gap:2px;padding-left:26px;">${aliasChips}</div>` : ''}
            </div>`;
        }).join('') : `<small style="opacity:0.6;">${searchTerm ? 'No matches' : 'No characters'}</small>`;

        // Color input + double-click for harmony popup
        list.querySelectorAll('.dc-color-input').forEach(i => {
            i.oninput = () => { const c = characterColors[i.dataset.key]; c.color = i.value; c.aliases?.forEach(a => { const ak = a.toLowerCase(); if (characterColors[ak]) characterColors[ak].color = i.value; }); saveHistory(); saveData(); injectPrompt(); updateCharList(); };
            i.ondblclick = (e) => { e.preventDefault(); showHarmonyPopup(i.dataset.key, i); };
        });
        list.querySelectorAll('.dc-color-dot').forEach(dot => {
            dot.onclick = () => { const input = dot.nextElementSibling; if (input?.classList.contains('dc-color-input')) input.click(); };
        });
        list.querySelectorAll('.dc-del').forEach(b => { b.onclick = () => { delete characterColors[b.dataset.key]; selectedKeys.delete(b.dataset.key); saveHistory(); saveData(); injectPrompt(); updateCharList(); }; });
        list.querySelectorAll('.dc-lock').forEach(b => { b.onclick = () => { characterColors[b.dataset.key].locked = !characterColors[b.dataset.key].locked; saveData(); updateCharList(); }; });
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
                    if (alias) { characterColors[b.dataset.key].aliases = characterColors[b.dataset.key].aliases || []; characterColors[b.dataset.key].aliases.push(alias); saveData(); injectPrompt(); updateCharList(); }
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
                    characterColors[key].aliases = characterColors[key].aliases.filter(a => a !== alias);
                    saveData(); injectPrompt(); updateCharList();
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
                    characterColors[key].group = inp.value.trim();
                    saveData(); updateCharList();
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
        if ($('dc-right-click')) $('dc-right-click').checked = settings.enableRightClick;
        if ($('dc-legend')) $('dc-legend').checked = settings.showLegend;
        if ($('dc-disable-narration')) $('dc-disable-narration').checked = settings.disableNarration !== false;
        if ($('dc-share-global')) $('dc-share-global').checked = settings.shareColorsGlobally || false;
        if ($('dc-css-effects')) $('dc-css-effects').checked = settings.cssEffects || false;
        if ($('dc-theme')) $('dc-theme').value = settings.themeMode;
        if ($('dc-brightness')) { $('dc-brightness').value = settings.brightness || 0; }
        if ($('dc-bright-val')) $('dc-bright-val').textContent = settings.brightness || 0;
        if ($('dc-narrator')) $('dc-narrator').value = settings.narratorColor || '#888888';
        if ($('dc-thought-symbols')) $('dc-thought-symbols').value = settings.thoughtSymbols || '';
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
                        <label class="checkbox_label"><input type="checkbox" id="dc-enabled"><span>Enable</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-highlight"><span>Highlight mode</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-legend"><span>Show floating legend</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-css-effects"><span>CSS effects (emotion/magic transforms)</span></label>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Theme:</label><select id="dc-theme" class="text_pole" style="flex:1;"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Palette:</label><select id="dc-palette" class="text_pole" style="flex:1;"></select><button id="dc-save-palette" class="menu_button" style="padding:2px 6px;font-size:0.8em;" title="Save current colors as custom palette">+</button><button id="dc-del-palette" class="menu_button" style="padding:2px 6px;font-size:0.8em;" title="Delete custom palette">&minus;</button></div>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Bright:</label><input type="range" id="dc-brightness" min="-30" max="30" value="0" style="flex:1;"><span id="dc-bright-val">0</span></div>
                    </div>
                </details>
                <details class="dc-section">
                    <summary style="cursor:pointer;font-weight:bold;margin-bottom:4px;">Behavior</summary>
                    <div style="display:flex;flex-direction:column;gap:4px;padding-left:4px;">
                        <label class="checkbox_label"><input type="checkbox" id="dc-autoscan"><span>Auto-scan on chat load</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-autoscan-new"><span>Auto-scan new messages</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-auto-lock"><span>Auto-lock detected characters</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-right-click"><span>Enable right-click context menu</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-disable-narration"><span>Disable narration coloring</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-share-global"><span>Share colors across all chats</span></label>
                        <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Narr:</label><input type="color" id="dc-narrator" value="#888888" style="width:24px;height:20px;"><button id="dc-narrator-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;"><label style="width:50px;" title="Symbols for inner thoughts (*etc)">Think:</label><input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole" style="width:60px;padding:3px;"><button id="dc-thought-add" class="menu_button" style="padding:2px 6px;font-size:0.8em;">+</button><button id="dc-thought-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                    </div>
                </details>
                <details class="dc-section">
                    <summary style="cursor:pointer;font-weight:bold;margin-bottom:4px;">Actions</summary>
                    <div style="display:flex;flex-direction:column;gap:4px;padding-left:4px;">
                        <div style="display:flex;gap:4px;"><button id="dc-scan" class="menu_button" style="flex:1;">Scan</button><button id="dc-clear" class="menu_button" style="flex:1;">Clear</button><button id="dc-stats" class="menu_button" style="flex:1;" title="Dialogue statistics">Stats</button></div>
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
                        <div style="display:flex;gap:4px;"><button id="dc-del-locked" class="menu_button" style="flex:1;" title="Delete all locked characters">DelLocked</button><button id="dc-del-unlocked" class="menu_button" style="flex:1;" title="Delete all unlocked characters">DelUnlocked</button><button id="dc-del-least" class="menu_button" style="flex:1;" title="Delete characters below dialogue threshold">DelLeast</button><button id="dc-del-dupes" class="menu_button" style="flex:1;" title="Delete duplicate colors, keep highest dialogue count">DelDupes</button></div>
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
                            <button id="dc-batch-style" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Style</button>
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
        $('dc-right-click').onchange = e => { settings.enableRightClick = e.target.checked; saveData(); };
        $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
        $('dc-disable-narration').onchange = e => { settings.disableNarration = e.target.checked; saveData(); injectPrompt(); };
        $('dc-share-global').onchange = e => { settings.shareColorsGlobally = e.target.checked; saveData(); loadData(); updateCharList(); injectPrompt(); };
        $('dc-css-effects').onchange = e => { settings.cssEffects = e.target.checked; saveData(); injectPrompt(); };
        $('dc-theme').onchange = e => { settings.themeMode = e.target.value; invalidateThemeCache(); saveData(); injectPrompt(); };
        $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); };
        $('dc-brightness').oninput = e => { settings.brightness = parseInt(e.target.value); $('dc-bright-val').textContent = e.target.value; saveData(); invalidateThemeCache(); injectPrompt(); };
        $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); };
        $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); };
        $('dc-thought-symbols').oninput = e => { settings.thoughtSymbols = e.target.value; saveData(); injectPrompt(); };
        $('dc-thought-add').onclick = () => { const s = prompt('Add thought symbol (e.g., *, 「, 『):'); if (s?.trim()) { settings.thoughtSymbols = (settings.thoughtSymbols || '') + s.trim(); $('dc-thought-symbols').value = settings.thoughtSymbols; saveData(); injectPrompt(); document.querySelectorAll('.mes').forEach(m => colorThoughts(m)); } };
        $('dc-thought-clear').onclick = () => { settings.thoughtSymbols = ''; $('dc-thought-symbols').value = ''; saveData(); injectPrompt(); };
        $('dc-scan').onclick = scanAllMessages;
        $('dc-clear').onclick = () => { characterColors = {}; selectedKeys.clear(); saveHistory(); saveData(); injectPrompt(); updateCharList(); };
        $('dc-stats').onclick = showStatsPopup;
        $('dc-fix-conflicts').onclick = autoResolveConflicts;
        $('dc-regen').onclick = regenerateAllColors;
        $('dc-flip-theme').onclick = flipColorsForTheme;
        $('dc-save-preset').onclick = saveColorPreset;
        $('dc-load-preset').onclick = loadColorPreset;
        $('dc-delete-preset').onclick = deleteColorPreset;
        $('dc-save-palette').onclick = saveCustomPalette;
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
                        characterColors[key].color = color;
                    } else {
                        characterColors[key] = { color, name: char.name, locked: false, aliases: [], style: '', dialogueCount: 0, group: '' };
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
        $('dc-del-locked').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (characterColors[k].locked) { delete characterColors[k]; selectedKeys.delete(k); count++; } }); saveHistory(); saveData(); injectPrompt(); updateCharList(); toastr?.info?.(`Deleted ${count} locked characters`); };
        $('dc-del-unlocked').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (!characterColors[k].locked) { delete characterColors[k]; selectedKeys.delete(k); count++; } }); saveHistory(); saveData(); injectPrompt(); updateCharList(); toastr?.info?.(`Deleted ${count} unlocked characters`); };
        $('dc-del-least').onclick = () => {
            const threshold = prompt('Delete characters with fewer than N dialogues.\nEnter minimum dialogue count to keep:', '3');
            if (threshold === null) return;
            const min = parseInt(threshold, 10);
            if (isNaN(min) || min < 0) { toastr?.warning?.('Invalid threshold'); return; }
            let count = 0;
            Object.keys(characterColors).forEach(k => {
                if ((characterColors[k].dialogueCount || 0) < min) {
                    delete characterColors[k]; selectedKeys.delete(k); count++;
                }
            });
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            toastr?.info?.(`Deleted ${count} characters with <${min} dialogues`);
        };
        $('dc-del-dupes').onclick = () => {
            const colorGroups = {};
            Object.entries(characterColors).forEach(([k, v]) => {
                const c = v.color.toLowerCase();
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
            saveHistory(); saveData(); injectPrompt(); updateCharList();
            toastr?.info?.(`Deleted ${deleted} duplicate-color characters`);
        };
        $('dc-lock-all').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (!characterColors[k].locked) { characterColors[k].locked = true; count++; } }); saveData(); updateCharList(); toastr?.info?.(`Locked ${count} characters`); };
        $('dc-unlock-all').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (characterColors[k].locked) { characterColors[k].locked = false; count++; } }); saveData(); updateCharList(); toastr?.info?.(`Unlocked ${count} characters`); };
        $('dc-reset').onclick = () => { if (confirm('Reset all colors?')) { Object.values(characterColors).forEach(c => { if (!c.locked) c.color = getNextColor(); }); saveHistory(); saveData(); updateCharList(); injectPrompt(); } };
        $('dc-search').oninput = e => { searchTerm = e.target.value; updateCharList(); };
        $('dc-sort').onchange = e => { sortMode = e.target.value; updateCharList(); };
        $('dc-add-btn').onclick = () => { addCharacter($('dc-add-name').value); $('dc-add-name').value = ''; };
        $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };

        // Phase 6A: Batch operations
        $('dc-batch-all').onclick = () => { Object.keys(characterColors).forEach(k => selectedKeys.add(k)); updateCharList(); };
        $('dc-batch-none').onclick = () => { selectedKeys.clear(); updateCharList(); };
        $('dc-batch-del').onclick = () => { if (!selectedKeys.size) return; selectedKeys.forEach(k => delete characterColors[k]); selectedKeys.clear(); saveHistory(); saveData(); injectPrompt(); updateCharList(); toastr?.info?.('Deleted selected characters'); };
        $('dc-batch-lock').onclick = () => { selectedKeys.forEach(k => { if (characterColors[k]) characterColors[k].locked = true; }); saveData(); updateCharList(); toastr?.info?.('Locked selected characters'); };
        $('dc-batch-unlock').onclick = () => { selectedKeys.forEach(k => { if (characterColors[k]) characterColors[k].locked = false; }); saveData(); updateCharList(); toastr?.info?.('Unlocked selected characters'); };
        $('dc-batch-style').onclick = () => {
            const style = prompt('Style for selected (bold, italic, bold italic, or blank):');
            if (style === null) return;
            const styles = ['', 'bold', 'italic', 'bold italic'];
            const validStyle = styles.includes(style) ? style : '';
            selectedKeys.forEach(k => { if (characterColors[k]) characterColors[k].style = validStyle; });
            saveData(); injectPrompt(); updateCharList();
        };

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); redo(); }
        });

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
            syncUIWithSettings();
        }
        updateCharList();
        injectPrompt();
        if (settings.autoScanOnLoad !== false && !Object.keys(characterColors).length) {
            setTimeout(() => { if (document.querySelectorAll('.mes').length) scanAllMessages(); }, 1000);
        }
    });
})();
