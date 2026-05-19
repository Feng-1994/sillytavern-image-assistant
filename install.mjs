#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pluginSourceDir = path.join(__dirname, 'server-plugin');
const sillynTavernRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const pluginTargetDir = path.join(sillynTavernRoot, 'plugins', 'sillytavern-image-assistant');
const pluginsDir = path.join(sillynTavernRoot, 'plugins');
const configFile = path.join(sillynTavernRoot, 'config.yaml');
const corsProxyFile = path.join(sillynTavernRoot, 'src', 'middleware', 'corsProxy.js');
const stPackageJson = path.join(sillynTavernRoot, 'package.json');

const MIN_ST_VERSION = '1.17.0';

function ensurePluginInstalled() {
    if (!fs.existsSync(pluginSourceDir)) {
        console.log('[Image Assistant] No server-plugin directory found, skipping plugin installation');
        return false;
    }

    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }

    if (!fs.existsSync(pluginTargetDir)) {
        fs.mkdirSync(pluginTargetDir, { recursive: true });
    }

    const files = fs.readdirSync(pluginSourceDir);
    for (const file of files) {
        const src = path.join(pluginSourceDir, file);
        const dest = path.join(pluginTargetDir, file);
        if (fs.statSync(src).isDirectory()) {
            fs.cpSync(src, dest, { recursive: true, force: true });
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    console.log(`[Image Assistant] Server plugin installed to: ${pluginTargetDir}`);
    return true;
}

function parseSemver(versionStr) {
    const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function semverGte(a, b) {
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] > b[i]) return true;
        if (a[i] < b[i]) return false;
    }
    return true;
}

function getSillyTavernVersion() {
    if (!fs.existsSync(stPackageJson)) {
        console.warn('[Image Assistant] SillyTavern package.json not found at:', stPackageJson);
        return null;
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(stPackageJson, 'utf8'));
        const version = pkg.version;
        if (!version) {
            console.warn('[Image Assistant] No version field found in SillyTavern package.json');
            return null;
        }
        console.log(`[Image Assistant] Detected SillyTavern version: ${version}`);
        return version;
    } catch (e) {
        console.warn('[Image Assistant] Failed to parse SillyTavern package.json:', e.message);
        return null;
    }
}

function checkVersionSupport() {
    const version = getSillyTavernVersion();
    if (!version) {
        console.warn('[Image Assistant] Could not determine SillyTavern version - assuming native X-Target-Authorization support is present');
        return true;
    }

    const current = parseSemver(version);
    const minimum = parseSemver(MIN_ST_VERSION);

    if (!current) {
        console.warn('[Image Assistant] Could not parse SillyTavern version - assuming native X-Target-Authorization support is present');
        return true;
    }

    if (semverGte(current, minimum)) {
        console.log(`[Image Assistant] SillyTavern ${version} >= ${MIN_ST_VERSION} - native X-Target-Authorization support available, no CORS proxy patching needed`);
        return true;
    }

    console.warn(`[Image Assistant] SillyTavern ${version} < ${MIN_ST_VERSION} - native X-Target-Authorization support may not be available`);
    console.warn('[Image Assistant] Consider upgrading SillyTavern to 1.17.0 or later for best compatibility');
    return false;
}

function updateConfig() {
    if (!fs.existsSync(configFile)) {
        console.warn('[Image Assistant] config.yaml not found at:', configFile);
        return;
    }

    const content = fs.readFileSync(configFile, 'utf8');
    const lines = content.split('\n');
    let changed = false;
    const keysToEnsure = [
        { key: 'enableServerPlugins', value: true, label: 'server plugins' },
        { key: 'enableCorsProxy', value: true, label: 'CORS proxy' },
    ];

    for (const { key, value, label } of keysToEnsure) {
        const keyPattern = new RegExp(`^${key}\\s*:`);
        const existingLineIndex = lines.findIndex(line => keyPattern.test(line.trim()));

        if (existingLineIndex >= 0) {
            const existingLine = lines[existingLineIndex].trim();
            const valuePattern = new RegExp(`^${key}\\s*:\\s*${value}\\s*$`);
            if (valuePattern.test(existingLine)) {
                console.log(`[Image Assistant] ${label} already enabled in config.yaml`);
            } else {
                const currentValue = existingLine.replace(new RegExp(`^${key}\\s*:\\s*`), '').trim();
                console.log(`[Image Assistant] ${key} is already set to "${currentValue}" in config.yaml - not overwriting`);
                console.log(`[Image Assistant] To use this extension, please set ${key}: ${value} manually`);
            }
        } else {
            lines.push(`${key}: ${value}`);
            console.log(`[Image Assistant] Added ${key}: ${value} to config.yaml`);
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(configFile, lines.join('\n'), 'utf8');
    }
}

function cleanupLegacyPatches() {
    const backupFile = corsProxyFile + '.bak';

    if (fs.existsSync(backupFile)) {
        try {
            fs.copyFileSync(backupFile, corsProxyFile);
            fs.unlinkSync(backupFile);
            console.log('[Image Assistant] Restored corsProxy.js from backup and removed .bak file');
            return;
        } catch (e) {
            console.warn('[Image Assistant] Failed to restore corsProxy.js from backup:', e.message);
        }
    }

    if (!fs.existsSync(corsProxyFile)) {
        return;
    }

    let content = fs.readFileSync(corsProxyFile, 'utf8');
    let modified = false;

    const hasLegacyPatch =
        content.includes('x-target-authorization') &&
        content.includes("headers['authorization'] = headers['x-target-authorization']");

    if (!hasLegacyPatch) {
        return;
    }

    const authPatchBlock = /\n\s*if\s*\(headers\['x-target-authorization'\]\)\s*\{\s*\n\s*headers\['authorization'\]\s*=\s*headers\['x-target-authorization'\];\s*\n\s*\}\s*else\s*\{\s*\n\s*delete headers\['authorization'\];\s*\n\s*\}/;
    if (authPatchBlock.test(content)) {
        content = content.replace(authPatchBlock, '');
        modified = true;
        console.log('[Image Assistant] Removed legacy X-Target-Authorization auth patch block from corsProxy.js');
    }

    const headerListPatch = /'x-target-authorization',\n/;
    if (headerListPatch.test(content)) {
        content = content.replace(headerListPatch, '');
        modified = true;
        console.log('[Image Assistant] Removed legacy x-target-authorization header list entry from corsProxy.js');
    }

    if (modified) {
        fs.writeFileSync(corsProxyFile, content, 'utf8');
        console.log('[Image Assistant] Cleaned up legacy patches from corsProxy.js');
    }
}

const pluginInstalled = ensurePluginInstalled();
updateConfig();

const nativeSupport = checkVersionSupport();
if (nativeSupport) {
    cleanupLegacyPatches();
}

if (pluginInstalled) {
    console.log('\n[Image Assistant] ✅ Installation complete! Please restart SillyTavern to activate the plugin.');
} else {
    console.log('\n[Image Assistant] ⚠️ Plugin installation skipped, but config may have been updated.');
}
