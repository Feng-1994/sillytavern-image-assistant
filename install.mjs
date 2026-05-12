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

const pluginInstalled = ensurePluginInstalled();
updateConfig();

if (pluginInstalled) {
    console.log('\n[Image Assistant] ✅ Installation complete! Please restart SillyTavern to activate the plugin.');
} else {
    console.log('\n[Image Assistant] ⚠️ Plugin installation skipped, but config may have been updated.');
}
