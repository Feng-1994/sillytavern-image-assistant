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

function updateConfig() {
    if (!fs.existsSync(configFile)) {
        console.warn('[Image Assistant] config.yaml not found at:', configFile);
        return;
    }

    let config = fs.readFileSync(configFile, 'utf8');
    let changed = false;

    if (config.includes('enableServerPlugins: false')) {
        config = config.replace('enableServerPlugins: false', 'enableServerPlugins: true');
        console.log('[Image Assistant] Enabled server plugins in config.yaml');
        changed = true;
    } else if (!config.includes('enableServerPlugins')) {
        config += '\n# -- Enabled by sillytavern-image-assistant --\nenableServerPlugins: true\n';
        console.log('[Image Assistant] Added enableServerPlugins: true to config.yaml');
        changed = true;
    } else {
        console.log('[Image Assistant] Server plugins already enabled in config.yaml');
    }

    if (config.includes('enableCorsProxy: false')) {
        config = config.replace('enableCorsProxy: false', 'enableCorsProxy: true');
        console.log('[Image Assistant] Enabled CORS proxy in config.yaml');
        changed = true;
    } else if (!config.includes('enableCorsProxy')) {
        config += '\n# -- Enabled by sillytavern-image-assistant --\nenableCorsProxy: true\n';
        console.log('[Image Assistant] Added enableCorsProxy: true to config.yaml');
        changed = true;
    } else {
        console.log('[Image Assistant] CORS proxy already enabled in config.yaml');
    }

    if (changed) {
        fs.writeFileSync(configFile, config, 'utf8');
    }
}

function patchCorsProxy() {
    if (!fs.existsSync(corsProxyFile)) {
        console.warn('[Image Assistant] corsProxy.js not found at:', corsProxyFile);
        return;
    }

    let content = fs.readFileSync(corsProxyFile, 'utf8');

    if (content.includes('x-target-authorization') && content.includes("headers['authorization'] = headers['x-target-authorization']")) {
        console.log('[Image Assistant] CORS proxy already patched for X-Target-Authorization support');
        return;
    }

    const patchMarker = "headersToRemove.forEach(header => delete headers[header]);";
    if (!content.includes(patchMarker)) {
        console.warn('[Image Assistant] Could not find patch point in corsProxy.js - skipping auto-patch');
        console.warn('[Image Assistant] You may need to manually add X-Target-Authorization support to your CORS proxy');
        return;
    }

    const backupFile = corsProxyFile + '.bak';
    if (!fs.existsSync(backupFile)) {
        fs.copyFileSync(corsProxyFile, backupFile);
        console.log('[Image Assistant] Backed up corsProxy.js to corsProxy.js.bak');
    }

    if (!content.includes("'x-target-authorization',")) {
        content = content.replace(
            "'sec-fetch-dest',",
            "'sec-fetch-dest',\n    'x-target-authorization',"
        );
    }

    const authPatch = `

    if (headers['x-target-authorization']) {
        headers['authorization'] = headers['x-target-authorization'];
    } else {
        delete headers['authorization'];
    }`;

    if (content.includes('x-target-authorization') && !content.includes("headers['authorization'] = headers['x-target-authorization']")) {
        content = content.replace(
            patchMarker,
            patchMarker + authPatch
        );
    }

    fs.writeFileSync(corsProxyFile, content, 'utf8');
    console.log('[Image Assistant] Patched corsProxy.js for X-Target-Authorization support');
}

const pluginInstalled = ensurePluginInstalled();
updateConfig();
patchCorsProxy();

if (pluginInstalled) {
    console.log('\n[Image Assistant] ✅ Installation complete! Please restart SillyTavern to activate the plugin.');
} else {
    console.log('\n[Image Assistant] ⚠️ Plugin installation skipped, but config and CORS proxy may have been updated.');
}
