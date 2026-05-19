import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';

const CNB_API_BASE = 'https://api.cnb.cool';
const sshTunnels = new Map();

function encodeRepoPath(repo) {
    return repo.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function validateRepoPath(repo) {
    if (!repo || typeof repo !== 'string') return { valid: false, error: '仓库路径为空' };
    const trimmed = repo.trim();
    if (trimmed !== repo) return { valid: false, error: '仓库路径包含前后空格', normalized: trimmed };
    const parts = trimmed.split('/');
    if (parts.length < 2) return { valid: false, error: '仓库路径格式错误，应为: 组织名/仓库名' };
    if (/[:\s]/.test(trimmed)) return { valid: false, error: '仓库路径包含非法字符（冒号或空格），请确认路径是否正确' };
    return { valid: true, normalized: trimmed };
}

function getExtensionSettings(request) {
    try {
        const dataRoot = request.app?.locals?.dataRoot || path.join(process.cwd(), 'data');
        const userDir = request.user?.directories?.root || path.join(dataRoot, 'default-user');
        const settingsPath = path.join(userDir, 'settings.json');
        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return data.extension_settings?.['sillytavern-image-assistant'] || {};
    } catch (e) {
        return {};
    }
}

async function cnbFetch(urlPath, options = {}) {
    const url = `${CNB_API_BASE}${urlPath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                'Authorization': `Bearer ${options.token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    } catch (e) {
        clearTimeout(timeout);
        return { ok: false, status: 0, data: { error: e.message } };
    }
}

async function getActiveWorkspace(token, repo) {
    const result = await cnbFetch(`/workspace/list?slug=${encodeURIComponent(repo)}&page=1&page_size=10`, { token });
    if (!result.ok) return null;
    const workspaces = Array.isArray(result.data) ? result.data : (result.data?.list || []);
    return workspaces.find(w => w.status?.toLowerCase() === 'running') || null;
}

async function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

async function checkPortAlive(port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.connect(port, '127.0.0.1');
    });
}

async function ensureSshTunnel(token, repo) {
    const tunnelKey = repo;

    const existing = sshTunnels.get(tunnelKey);
    if (existing && existing.process && !existing.process.killed) {
        const isAlive = await checkPortAlive(existing.localPort);
        if (isAlive) {
            return { localPort: existing.localPort, reused: true };
        }
        try { existing.process.kill(); } catch (_) { }
        sshTunnels.delete(tunnelKey);
    }

    const ws = await getActiveWorkspace(token, repo);
    if (!ws) return { error: '没有运行中的CNB Workspace' };

    const detailResult = await cnbFetch(`/${encodeRepoPath(repo)}/-/workspace/detail/${ws.sn}`, { token });
    if (!detailResult.ok || !detailResult.data?.ssh) {
        return { error: '无法获取Workspace SSH连接信息' };
    }

    const sshHost = detailResult.data.remoteSsh || detailResult.data.ssh;
    if (!sshHost) return { error: 'SSH连接信息为空' };

    const localPort = await findFreePort();
    const remotePort = 8188;

    const sshDir = path.join(process.env.USERPROFILE || process.env.HOME, '.ssh');
    const cnbKeyPath = path.join(sshDir, 'cnb_comfyui');
    const hasCnbKey = fs.existsSync(cnbKeyPath);

    const sshArgs = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'ExitOnForwardFailure=yes',
    ];

    if (hasCnbKey) {
        sshArgs.push('-o', `IdentityFile=${cnbKeyPath}`);
    }

    sshArgs.push('-L', `${localPort}:127.0.0.1:${remotePort}`);
    sshArgs.push('-N');
    sshArgs.push(sshHost);

    let sshProcess;
    try {
        sshProcess = spawn('ssh', sshArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });
    } catch (e) {
        return { error: `SSH启动失败: ${e.message}。请确保系统已安装OpenSSH客户端。` };
    }

    let started = false;
    let errorMsg = '';

    await new Promise((resolve) => {
        const timeout = setTimeout(() => {
            if (!started) {
                errorMsg = 'SSH隧道连接超时';
                resolve();
            }
        }, 15000);

        sshProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg.includes('Warning: Permanently added') || msg.includes('debug')) {
                return;
            }
            if (msg.includes('Permission denied') || msg.includes('Connection refused') || msg.includes('Could not resolve')) {
                errorMsg = `SSH连接失败: ${msg}`;
                clearTimeout(timeout);
                resolve();
            }
        });

        sshProcess.on('error', (err) => {
            if (err.code === 'ENOENT') {
                errorMsg = 'SSH命令未找到，请安装OpenSSH客户端';
            } else {
                errorMsg = `SSH进程错误: ${err.message}`;
            }
            clearTimeout(timeout);
            resolve();
        });

        sshProcess.on('close', (code) => {
            if (!started && code !== 0) {
                errorMsg = `SSH进程退出，代码: ${code}`;
            }
            clearTimeout(timeout);
            resolve();
        });

        const checkInterval = setInterval(async () => {
            const alive = await checkPortAlive(localPort);
            if (alive) {
                started = true;
                clearTimeout(timeout);
                clearInterval(checkInterval);
                resolve();
            }
        }, 500);
    });

    if (!started) {
        try { sshProcess.kill(); } catch (_) { }
        return { error: errorMsg || 'SSH隧道建立失败' };
    }

    sshTunnels.set(tunnelKey, {
        process: sshProcess,
        localPort,
        remotePort,
        sshHost,
        pipelineId: ws.pipeline_id,
        createdAt: Date.now(),
    });

    sshProcess.on('close', () => {
        sshTunnels.delete(tunnelKey);
    });

    return { localPort, reused: false };
}

export const info = {
    id: 'sillytavern-image-assistant',
    name: 'Image Assistant CNB Plugin',
    description: 'CNB ComfyUI cloud service management backend for the Image Assistant extension',
};

export async function init(router) {
    router.get('/test-token', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const [userResult, groupResult] = await Promise.all([
            cnbFetch('/user', { token }),
            cnbFetch('/user/groups?page=1&page_size=1', { token }),
        ]);

        return response.json({
            valid: userResult.ok || groupResult.ok,
            status: userResult.status,
            message: (userResult.ok || groupResult.ok) ? 'Token验证成功' : (userResult.data?.message || 'Token验证失败'),
            username: userResult.data?.username || null,
            nickname: userResult.data?.nickname || null,
        });
    });

    router.get('/validate-repo', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const repo = request.query.repo;
        if (!repo) return response.status(400).json({ error: '缺少repo参数' });

        const validation = validateRepoPath(repo);
        if (!validation.valid) {
            return response.json({
                valid: false,
                error: validation.error,
                hint: '仓库路径格式应为: 组织名/仓库名（如 my-org/comfyui），不包含中文、空格或冒号',
                received: repo,
            });
        }

        const result = await cnbFetch(`/${encodeRepoPath(validation.normalized)}`, { token });
        if (result.ok) {
            return response.json({
                valid: true,
                exists: true,
                path: result.data.path,
                name: result.data.name,
                description: (result.data.description || '').substring(0, 100),
                defaultBranch: result.data.default_branch || 'main',
                webUrl: result.data.web_url,
            });
        }

        if (result.status === 404) {
            return response.json({
                valid: true,
                exists: false,
                error: `仓库 ${validation.normalized} 不存在或无权访问`,
            });
        }

        return response.json({
            valid: true,
            exists: false,
            error: `验证失败 (HTTP ${result.status}): ${result.data?.message || '未知错误'}`,
        });
    });

    router.get('/repos', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const page = parseInt(request.query.page) || 1;
        const pageSize = parseInt(request.query.page_size) || 50;

        const result = await cnbFetch(`/user/repos?page=${page}&page_size=${pageSize}`, { token });
        if (!result.ok) return response.status(result.status).json(result.data);

        const repos = Array.isArray(result.data) ? result.data : (result.data?.list || []);
        const formatted = repos.map(r => ({
            path: r.path || r.full_path || r.path_with_namespace || `${r.namespace?.path || ''}/${r.name}`,
            name: r.name,
            description: r.description || '',
            defaultBranch: r.default_branch || 'main',
            visibility: r.visibility_level || r.visibility || '',
            updatedAt: r.updated_at || '',
        }));

        return response.json({ repos: formatted, total: result.data?.total || formatted.length });
    });

    router.get('/branches', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const repo = request.query.repo;
        if (!repo) return response.status(400).json({ error: '缺少repo参数' });

        const page = parseInt(request.query.page) || 1;
        const pageSize = parseInt(request.query.page_size) || 50;

        const result = await cnbFetch(`/${encodeRepoPath(repo)}/-/git/branches?page=${page}&page_size=${pageSize}`, { token });
        if (!result.ok) return response.status(result.status).json(result.data);

        const branches = Array.isArray(result.data) ? result.data : (result.data?.list || []);
        const formatted = branches.map(b => ({
            name: b.name,
            isDefault: b.is_default || false,
            updatedAt: b.commit?.committed_date || b.updated_at || '',
        }));

        return response.json({ branches: formatted });
    });

    router.get('/workspace-status', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const repo = request.query.repo;
        if (!repo) return response.status(400).json({ error: '缺少repo参数' });

        const validation = validateRepoPath(repo);
        if (!validation.valid) {
            return response.status(400).json({
                error: validation.error,
                hint: '仓库路径格式应为: 组织名/仓库名（如 my-org/comfyui），不包含中文、空格或冒号',
                received: repo,
            });
        }

        const ws = await getActiveWorkspace(token, validation.normalized);
        if (!ws) {
            return response.json({ status: 'offline', workspace: null, comfyProxyUrl: null, localTunnelUrl: null });
        }

        const detailResult = await cnbFetch(`/${encodeRepoPath(validation.normalized)}/-/workspace/detail/${ws.sn}`, { token });

        let comfyProxyUrl = null;
        let proxyRequiresAuth = false;
        let forwardedAddress = null;
        let forwardedAddressReachable = false;
        if (ws.pipeline_id) {
            forwardedAddress = `https://${ws.pipeline_id}-8188.cnb.run/`;
            console.log(`[Image Assistant] Forwarded Address: ${forwardedAddress}`);
            try {
                const probeController = new AbortController();
                const probeTimeout = setTimeout(() => probeController.abort(), 8000);
                const probeResp = await fetch(forwardedAddress, {
                    method: 'HEAD',
                    signal: probeController.signal,
                    redirect: 'follow',
                });
                clearTimeout(probeTimeout);
                if (probeResp.ok || probeResp.status === 200) {
                    forwardedAddressReachable = true;
                    console.log(`[Image Assistant] Forwarded Address is reachable`);
                } else {
                    console.log(`[Image Assistant] Forwarded Address returned HTTP ${probeResp.status}, ComfyUI may not be ready yet`);
                }
            } catch (e) {
                console.log(`[Image Assistant] Forwarded Address probe failed (${e.message}), ComfyUI may not be ready yet`);
            }
        }
        if (detailResult.ok && detailResult.data?.webide) {
            comfyProxyUrl = detailResult.data.webide.replace(/\/vscode-web\/.*/, `/proxy/${ws.pipeline_id}/8188`);
        }

        let localTunnelUrl = null;
        const tunnelRepo = settings.cnbRepoPath || validation.normalized;
        const tunnel = sshTunnels.get(tunnelRepo);
        if (tunnel && tunnel.process && !tunnel.process.killed) {
            localTunnelUrl = `http://127.0.0.1:${tunnel.localPort}`;
        }

        return response.json({
            status: ws.status?.toLowerCase() || 'unknown',
            workspace: {
                sn: ws.sn,
                pipelineId: ws.pipeline_id,
                branch: ws.branch,
                createTime: ws.create_time,
                duration: ws.duration,
                repoUrl: ws.repo_url,
            },
            detail: detailResult.ok ? detailResult.data : null,
            comfyProxyUrl,
            proxyRequiresAuth,
            forwardedAddress,
            forwardedAddressReachable,
            localTunnelUrl,
        });
    });

    router.get('/build-status/:repo/:sn', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const { repo, sn } = request.params;
        const result = await cnbFetch(`/${encodeRepoPath(repo)}/-/build/status/${sn}`, { token });

        return response.status(result.ok ? 200 : result.status).json(result.data);
    });

    router.post('/start', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置，请在扩展设置中填写' });

        const { repo, branch } = request.body;
        if (!repo) return response.status(400).json({ error: '缺少repo参数（仓库路径，如 my-org/comfyui-workspace）' });

        const validation = validateRepoPath(repo);
        if (!validation.valid) {
            return response.status(400).json({
                error: validation.error,
                hint: '仓库路径格式应为: 组织名/仓库名（如 my-org/comfyui），不包含中文、空格或冒号',
                received: repo,
            });
        }

        const normalizedRepo = validation.normalized;

        const existing = await getActiveWorkspace(token, normalizedRepo);
        if (existing) {
            return response.json({
                sn: existing.sn,
                pipelineId: existing.pipeline_id,
                status: existing.status,
                message: 'Workspace already running',
            });
        }

        const result = await cnbFetch(`/${encodeRepoPath(normalizedRepo)}/-/workspace/start`, {
            method: 'POST',
            token,
            body: { branch: branch || 'main' },
            timeout: 60000,
        });

        return response.status(result.ok ? 200 : result.status).json(result.data);
    });

    router.post('/stop', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        let { sn, pipelineId } = request.body;

        if (!sn && !pipelineId) {
            const repo = settings.cnbRepoPath;
            if (repo) {
                const ws = await getActiveWorkspace(token, repo);
                if (ws) {
                    sn = ws.sn;
                    pipelineId = ws.pipelineId || pipelineId;
                }
            }
        }

        if (!sn && !pipelineId) return response.status(400).json({ error: '缺少sn或pipelineId参数，且未找到运行中的Workspace' });

        const repo = settings.cnbRepoPath;
        if (repo) {
            const tunnel = sshTunnels.get(repo);
            if (tunnel) {
                try { tunnel.process.kill(); } catch (_) { }
                sshTunnels.delete(repo);
            }
        }

        const result = await cnbFetch('/workspace/stop', {
            method: 'POST',
            token,
            body: { sn, pipelineId },
        });

        return response.status(result.ok ? 200 : result.status).json(result.data);
    });

    router.post('/delete', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        let { sn, pipelineId } = request.body;

        if (!sn && !pipelineId) {
            const repo = settings.cnbRepoPath;
            if (repo) {
                const ws = await getActiveWorkspace(token, repo);
                if (ws) {
                    sn = ws.sn;
                    pipelineId = ws.pipelineId || pipelineId;
                }
            }
        }

        if (!sn && !pipelineId) return response.status(400).json({ error: '缺少sn或pipelineId参数，且未找到运行中的Workspace' });

        const result = await cnbFetch('/workspace/delete', {
            method: 'POST',
            token,
            body: { sn, pipelineId },
        });

        return response.status(result.ok ? 200 : result.status).json(result.data);
    });

    router.get('/list', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const params = new URLSearchParams();
        for (const key of ['slug', 'branch', 'status', 'page', 'page_size', 'start', 'end']) {
            if (request.query[key]) params.set(key, request.query[key]);
        }

        const result = await cnbFetch(`/workspace/list?${params.toString()}`, { token });

        return response.status(result.ok ? 200 : result.status).json(result.data);
    });

    router.post('/setup-tunnel', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const repo = settings.cnbRepoPath;
        if (!repo) return response.status(400).json({ error: 'CNB仓库路径未配置' });

        const result = await ensureSshTunnel(token, repo);

        if (result.error) {
            return response.status(502).json({
                error: result.error,
                hint: 'SSH隧道需要: 1) 系统安装OpenSSH客户端 2) CNB SSH密钥已配置到本地ssh-agent或~/.ssh/config',
            });
        }

        return response.json({
            localPort: result.localPort,
            localTunnelUrl: `http://127.0.0.1:${result.localPort}`,
            reused: result.reused,
        });
    });

    router.get('/ssh-status', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const sshDir = path.join(process.env.USERPROFILE || process.env.HOME, '.ssh');
        const cnbKeyPath = path.join(sshDir, 'cnb_comfyui');
        const cnbKeyPubPath = cnbKeyPath + '.pub';

        const hasSsh = (() => {
            try { execSync('where ssh 2>nul || which ssh 2>/dev/null'); return true; } catch { return false; }
        })();

        const hasCnbKey = fs.existsSync(cnbKeyPath);
        const hasSshConfig = (() => {
            const configPath = path.join(sshDir, 'config');
            if (!fs.existsSync(configPath)) return false;
            const content = fs.readFileSync(configPath, 'utf8');
            return content.includes('cnb.space');
        })();

        let cnbKeyUploaded = false;
        if (hasCnbKey && fs.existsSync(cnbKeyPubPath)) {
            const pubKey = fs.readFileSync(cnbKeyPubPath, 'utf8').trim();
            const keyComment = pubKey.split(' ').pop() || '';
            const checkResult = await cnbFetch('/user/public_keys', { token });
            if (checkResult.ok && Array.isArray(checkResult.data)) {
                cnbKeyUploaded = checkResult.data.some(k => k.key?.includes(keyComment) || k.title?.includes('cnb_comfyui'));
            }
        }

        return response.json({
            hasSsh,
            hasCnbKey,
            hasSshConfig,
            cnbKeyUploaded,
            sshDir,
            cnbKeyPath,
            ready: hasSsh && hasCnbKey && hasSshConfig && cnbKeyUploaded,
        });
    });

    router.post('/setup-ssh', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const sshDir = path.join(process.env.USERPROFILE || process.env.HOME, '.ssh');
        const cnbKeyPath = path.join(sshDir, 'cnb_comfyui');
        const cnbKeyPubPath = cnbKeyPath + '.pub';

        if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { recursive: true });
        }

        const steps = [];

        if (!fs.existsSync(cnbKeyPath)) {
            try {
                execSync(`ssh-keygen -t ed25519 -f "${cnbKeyPath}" -N "" -C "cnb_comfyui@silillytavern"`, {
                    stdio: 'pipe',
                    timeout: 10000,
                });
                steps.push('生成SSH密钥对: 成功');
            } catch (e) {
                return response.status(500).json({
                    error: `SSH密钥生成失败: ${e.message}`,
                    hint: '请确保系统已安装OpenSSH，或手动运行: ssh-keygen -t ed25519 -f ~/.ssh/cnb_comfyui -N ""',
                });
            }
        } else {
            steps.push('SSH密钥对: 已存在');
        }

        const pubKey = fs.readFileSync(cnbKeyPubPath, 'utf8').trim();

        const uploadResult = await cnbFetch('/user/public_keys', {
            method: 'POST',
            token,
            body: {
                title: 'cnb_comfyui@silillytavern',
                key: pubKey,
            },
        });

        if (uploadResult.ok) {
            steps.push('上传公钥到CNB: 成功');
        } else if (uploadResult.status === 409 || uploadResult.data?.message?.includes('already')) {
            steps.push('上传公钥到CNB: 已存在');
        } else {
            steps.push('上传公钥到CNB: 需要手动上传（CNB暂不支持API上传公钥）');
        }

        const configPath = path.join(sshDir, 'config');
        const cnbConfig = `
Host cnb.space
    IdentityFile ${cnbKeyPath}
    UserKnownHostsFile /dev/null
    StrictHostKeyChecking no
    LogLevel ERROR
`;

        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, cnbConfig.trim() + '\n');
            steps.push('创建SSH Config: 成功');
        } else {
            const config = fs.readFileSync(configPath, 'utf8');
            if (!config.includes('cnb.space')) {
                fs.appendFileSync(configPath, '\n' + cnbConfig);
                steps.push('更新SSH Config: 成功');
            } else {
                steps.push('SSH Config: 已配置');
            }
        }

        const needManualUpload = !uploadResult.ok && uploadResult.status !== 409;

        return response.json({
            success: !needManualUpload,
            steps,
            pubKey: needManualUpload ? pubKey : undefined,
            uploadUrl: needManualUpload ? 'https://cnb.cool/-/settings/ssh' : undefined,
            message: needManualUpload
                ? 'SSH密钥已生成并配置，但需要手动上传公钥到CNB。请复制公钥并访问CNB设置页面上传。'
                : 'SSH密钥配置完成！现在可以建立SSH隧道连接ComfyUI。',
        });
    });

    router.delete('/tunnel', async (request, response) => {
        const settings = getExtensionSettings(request);
        const repo = settings.cnbRepoPath;
        if (!repo) return response.status(400).json({ error: 'CNB仓库路径未配置' });

        const tunnel = sshTunnels.get(repo);
        if (tunnel) {
            try { tunnel.process.kill(); } catch (_) { }
            sshTunnels.delete(repo);
            return response.json({ message: 'SSH隧道已关闭' });
        }

        return response.json({ message: '没有活跃的SSH隧道' });
    });

    router.all('/comfyui-proxy/*', async (request, response) => {
        const settings = getExtensionSettings(request);
        const token = settings.cnbApiToken;
        if (!token) return response.status(400).json({ error: 'CNB API Token未配置' });

        const repo = settings.cnbRepoPath;
        if (!repo) return response.status(400).json({ error: 'CNB仓库路径未配置' });

        const tunnelResult = await ensureSshTunnel(token, repo);
        if (tunnelResult.error) {
            return response.status(502).json({
                error: tunnelResult.error,
                hint: '无法建立SSH隧道。请确保: 1) 系统已安装OpenSSH 2) CNB SSH密钥已配置',
            });
        }

        const proxyPath = request.params[0] || '';
        const targetUrl = `http://127.0.0.1:${tunnelResult.localPort}/${proxyPath}`;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const fetchOptions = {
                method: request.method,
                headers: {
                    'Accept': 'application/json',
                },
                body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body),
                signal: controller.signal,
            };

            const proxyResponse = await fetch(targetUrl, fetchOptions);
            clearTimeout(timeout);

            const contentType = proxyResponse.headers.get('content-type') || '';
            if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
                const buffer = Buffer.from(await proxyResponse.arrayBuffer());
                response.set('Content-Type', contentType);
                response.set('Content-Length', buffer.length);
                return response.send(buffer);
            }

            const text = await proxyResponse.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }

            return response.status(proxyResponse.status).json(typeof data === 'string' ? { data } : data);
        } catch (e) {
            return response.status(502).json({ error: `ComfyUI代理请求失败: ${e.message}` });
        }
    });

    console.log('Image Assistant CNB Plugin: routes registered under /api/plugins/sillytavern-image-assistant/');
}

export async function exit() {
    for (const [key, tunnel] of sshTunnels) {
        try { tunnel.process.kill(); } catch (_) { }
        sshTunnels.delete(key);
    }
    console.log('Image Assistant CNB Plugin: cleaned up SSH tunnels');
}
