import {
    event_types,
    eventSource,
    saveSettingsDebounced,
    chat,
    this_chid,
    generateQuietPrompt,
    sendMessageAsUser,
    Generate,
    getRequestHeaders,
    doNavbarIconClick,
} from '../../../../script.js';
import {
    extension_settings,
    getContext,
} from '../../../extensions.js';
import {
    SlashCommandParser,
} from '../../../slash-commands/SlashCommandParser.js';
import {
    SlashCommand,
} from '../../../slash-commands/SlashCommand.js';
import {
    ARGUMENT_TYPE,
    SlashCommandArgument,
    SlashCommandNamedArgument,
} from '../../../slash-commands/SlashCommandArgument.js';
import {
    getCharaFilename,
} from '../../../utils.js';
import { selected_group } from '../../../group-chats.js';

let JSZip = null;
async function ensureJSZip() {
    if (!JSZip) {
        try {
            await import('../../../../lib/jszip.min.js');
        } catch (_) { }
        JSZip = window.JSZip;
        if (!JSZip) {
            throw new Error('JSZip library failed to load');
        }
    }
    return JSZip;
}

const EXT_NAME = 'sillytavern-image-assistant';

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function withSdSettings(overrides, fn) {
    const sd = extension_settings.sd;
    if (!sd) return fn();
    const saved = {};
    for (const key of Object.keys(overrides)) {
        saved[key] = sd[key];
        sd[key] = overrides[key];
    }
    try {
        return await fn();
    } finally {
        for (const key of Object.keys(saved)) {
            sd[key] = saved[key];
        }
    }
}

const TAG_REGEXES = [
    { regex: /\[图片[：:]\s*([^\]]+)\]/g, type: 'static', label: '图片' },
    { regex: /\[动图[：:]\s*([^\]]+)\]/g, type: 'animated', label: '动图' },
    { regex: /\[📸图库新增[：:]\s*([^\]]+)\]/g, type: 'photo', label: '图库' },
    { regex: /\[微信图片[：:]\s*([^\]]+)\]/g, type: 'wechat', label: '微信图片' },
];

const MODEL_PROFILES = {
    animagine_xl_v31: {
        id: 'animagine_xl_v31',
        name: 'Animagine XL 3.1',
        pattern: /animagine.?xl.?v?3/i,
        type: 'sdxl',
        strengths: ['anime', 'manga', 'illustration', 'chinese_classical', 'fantasy'],
        description: 'SDXL动漫专用模型，擅长日系动漫、二次元插画、古风角色',
        defaultSize: '832x1216',
        sizeOptions: ['832x1216', '1024x1024', '1216x832'],
        recommendedWorkflow: 'Anime_TXT2IMG_Workflow.json',
        baseNegative: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name',
    },
    juggernaut_xl_v9: {
        id: 'juggernaut_xl_v9',
        name: 'Juggernaut XL v9',
        pattern: /juggernaut.?xl.?v?9/i,
        type: 'sdxl',
        strengths: ['realistic', 'photorealistic', 'cinematic', 'fantasy_dark', 'portrait'],
        description: 'SDXL写实专用模型，擅长真实照片、电影质感、人物肖像',
        defaultSize: '1024x1024',
        sizeOptions: ['1024x1024', '1216x832', '832x1216'],
        recommendedWorkflow: 'Default_Comfy_Workflow.json',
        baseNegative: 'nsfw, painting, cartoon, anime, illustration, 3d, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
    },
    flux_dev: {
        id: 'flux_dev',
        name: 'Flux Dev',
        pattern: /flux.?dev/i,
        type: 'flux',
        strengths: ['realistic', 'photorealistic', 'anime', 'cinematic', 'fantasy'],
        description: 'Flux模型，高质量通用生成，需要专用工作流',
        defaultSize: '1024x1024',
        sizeOptions: ['1024x1024', '1216x832', '832x1216'],
        recommendedWorkflow: 'Default_Comfy_Workflow.json',
        baseNegative: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
    },
    sd15: {
        id: 'sd15',
        name: 'Stable Diffusion 1.5',
        pattern: /stable.?diffusion.?v?1\.?5|sd.?v?1\.?5|sd1\.5/i,
        type: 'sd15',
        strengths: ['anime', 'illustration', 'manga'],
        description: 'SD 1.5经典模型，生态丰富，资源占用低',
        defaultSize: '512x768',
        sizeOptions: ['512x768', '512x512', '768x512'],
        recommendedWorkflow: 'Default_Comfy_Workflow.json',
        baseNegative: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
    },
};

const STYLE_CONFIGS = {
    anime: {
        label: '二次元', icon: '🎨', description: '日系动漫风格，色彩鲜明', recommendedModel: 'animagine_xl_v31',
        modelConfigs: {
            animagine_xl_v31: { promptPrefix: 'masterpiece, best quality, anime_style, year_2024, absurdres, detailed,', negativeExtra: '', scale: 5, steps: 28, sampler: 'euler_ancestral', size: '832x1216', workflow: 'Anime_TXT2IMG_Workflow.json', tip: 'Animagine XL 3.1 最佳风格' },
            juggernaut_xl_v9: { promptPrefix: 'masterpiece, best quality, anime style, illustration, detailed, vibrant colors,', negativeExtra: ', photorealistic, 3d render, blurry', scale: 6, steps: 25, sampler: 'dpmpp_2m', size: '1024x1024', workflow: 'Default_Comfy_Workflow.json', tip: 'Juggernaut需显式指定anime style' },
        },
    },
    realistic: {
        label: '写实', icon: '📷', description: '真实照片风格，细节逼真', recommendedModel: 'juggernaut_xl_v9',
        modelConfigs: {
            juggernaut_xl_v9: { promptPrefix: 'masterpiece, best quality, photorealistic, realistic, detailed, 8k, raw photo, film grain,', negativeExtra: ', anime, cartoon, illustration, 3d, painting, sketch, drawing, art, anime_style, render', scale: 7, steps: 30, sampler: 'dpmpp_2m', size: '1024x1024', workflow: 'Default_Comfy_Workflow.json', tip: 'Juggernaut XL v9 最佳风格' },
            animagine_xl_v31: { promptPrefix: 'masterpiece, best quality, photorealistic, realistic, detailed, 8k, raw photo,', negativeExtra: ', anime, cartoon, illustration, 3d, painting, sketch, drawing, art, anime_style, chibi, deformed', scale: 7, steps: 30, sampler: 'dpmpp_2m', size: '1024x1024', workflow: 'Default_Comfy_Workflow.json', tip: 'Animagine写实能力有限，建议切换Juggernaut' },
        },
    },
    chinese_classical: {
        label: '古风', icon: '🏮', description: '国风水墨风格，意境悠远', recommendedModel: 'animagine_xl_v31',
        modelConfigs: {
            animagine_xl_v31: { promptPrefix: 'masterpiece, best quality, chinese clothes, hanfu, traditional chinese art, elegant, detailed, year_2024,', negativeExtra: ', modern, western, sci-fi, cyberpunk, 3d render, deformed', scale: 5, steps: 28, sampler: 'euler_ancestral', size: '832x1216', workflow: 'Anime_TXT2IMG_Workflow.json', tip: 'Animagine擅长古风角色，使用hanfu标签' },
            juggernaut_xl_v9: { promptPrefix: 'masterpiece, best quality, chinese painting style, traditional chinese art, ink wash, elegant, detailed, realistic,', negativeExtra: ', modern, western, sci-fi, cyberpunk, anime_style, 3d render, cartoon', scale: 6, steps: 28, sampler: 'euler_ancestral', size: '1024x1024', workflow: 'Default_Comfy_Workflow.json', tip: 'Juggernaut偏写实古风，适合水墨画风格' },
        },
    },
    cinematic: {
        label: '电影感', icon: '🎬', description: '电影画面质感，光影氛围强烈', recommendedModel: 'juggernaut_xl_v9',
        modelConfigs: {
            juggernaut_xl_v9: { promptPrefix: 'masterpiece, best quality, cinematic, cinematic lighting, dramatic, film grain, depth of field, bokeh, 8k,', negativeExtra: ', anime, cartoon, illustration, 3d, painting, sketch, drawing, anime_style, flat color', scale: 7, steps: 30, sampler: 'dpmpp_2m', size: '1216x832', workflow: 'Default_Comfy_Workflow.json', tip: 'Juggernaut最佳电影风格，横版构图' },
            animagine_xl_v31: { promptPrefix: 'masterpiece, best quality, cinematic, dramatic lighting, depth of field, movie scene, year_2024,', negativeExtra: ', chibi, deformed, flat color, simple background', scale: 6, steps: 28, sampler: 'euler_ancestral', size: '1216x832', workflow: 'Anime_TXT2IMG_Workflow.json', tip: 'Animagine可生成动漫电影感' },
        },
    },
    fantasy: {
        label: '奇幻', icon: '🧙', description: '奇幻魔法风格，梦幻绚丽', recommendedModel: 'animagine_xl_v31',
        modelConfigs: {
            animagine_xl_v31: { promptPrefix: 'masterpiece, best quality, fantasy, magical, glowing, ethereal, anime_style, year_2024, detailed,', negativeExtra: ', modern, realistic, photorealistic, boring, plain', scale: 5, steps: 28, sampler: 'euler_ancestral', size: '832x1216', workflow: 'Anime_TXT2IMG_Workflow.json', tip: 'Animagine擅长奇幻动漫风' },
            juggernaut_xl_v9: { promptPrefix: 'masterpiece, best quality, fantasy art, magical, glowing, epic, detailed, dramatic lighting,', negativeExtra: ', anime, cartoon, chibi, simple, plain, boring', scale: 7, steps: 30, sampler: 'dpmpp_2m', size: '1024x1024', workflow: 'Default_Comfy_Workflow.json', tip: 'Juggernaut适合写实奇幻和史诗场景' },
        },
    },
    portrait: {
        label: '人物肖像', icon: '👤', description: '人物面部特写，精致细腻', recommendedModel: 'juggernaut_xl_v9',
        modelConfigs: {
            juggernaut_xl_v9: { promptPrefix: 'masterpiece, best quality, portrait, detailed face, detailed eyes, skin texture, 8k, raw photo,', negativeExtra: ', anime, cartoon, illustration, 3d, painting, deformed, bad anatomy, anime_style', scale: 7, steps: 30, sampler: 'dpmpp_2m', size: '832x1216', workflow: 'Story_Portrait_Comfy_Workflow.json', tip: 'Juggernaut最佳肖像风格' },
            animagine_xl_v31: { promptPrefix: 'masterpiece, best quality, portrait, detailed face, beautiful eyes, anime_style, year_2024,', negativeExtra: ', deformed, bad anatomy, chibi, simple, plain', scale: 5, steps: 28, sampler: 'euler_ancestral', size: '832x1216', workflow: 'Story_Portrait_Comfy_Workflow.json', tip: 'Animagine擅长动漫角色肖像' },
        },
    },
};

const WORKFLOW_DESCRIPTIONS = {
    'Default_Comfy_Workflow.json': {
        core: '标准文生图',
        advantage: '通用基础工作流，支持全部SD参数占位符',
    },
    'Anime_TXT2IMG_Workflow.json': {
        core: '动漫文生图',
        advantage: '基础动漫风格生成，支持标准参数配置',
    },
    'Char_Avatar_Comfy_Workflow.json': {
        core: '角色头像图生图',
        advantage: '基于角色头像变换，保留角色特征',
    },
    'Story_Portrait_Comfy_Workflow.json': {
        core: '人物立绘生成',
        advantage: '竖版高分辨率，适合全身角色立绘',
    },
    'Story_Scene_Comfy_Workflow.json': {
        core: '场景背景生成',
        advantage: '横版宽幅构图，优化无人物场景',
    },
    'Story_Static_Comfy_Workflow.json': {
        core: '高清静态图生成',
        advantage: '高分辨率输出，画面细节丰富',
    },
    'Story_Animation_Comfy_Workflow.json': {
        core: '动态动作图生成',
        advantage: '方形构图，强调动态姿态与运动感',
    },
    'Story_LTXVideo_Comfy_Workflow.json': {
        core: 'LTX视频生成',
        advantage: '使用LTX-Video模型生成短视频片段',
    },
};

const DEFAULT_SETTINGS = {
    enabled: true,
    autoProcessTags: true,
    removeTagAfterProcess: false,
    showToasts: true,
    expansionMethod: 'direct',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:7b',
    remoteApiUrl: '',
    remoteApiKey: '',
    remoteApiModel: '',
    remoteApiFormat: 'openai',
    remoteApiTimeout: 30,
    style: 'anime',
    comfyWorkflow: '',
    qualityAssessment: true,
    autoRetryOnLowQuality: true,
    maxRetries: 1,
    generationLog: [],
    characterPrompts: {},
    characterNegatives: {},
    modelCheckEnabled: true,
    cnbEnabled: false,
    cnbProjectUrl: '',
    cnbApiToken: '',
    cnbRepoPath: '',
    cnbBranch: 'main',
    cnbAutoWake: true,
    cnbWakeTimeout: 120,
    cnbPollInterval: 5,
    cnbKeepAlive: false,
    cnbKeepAliveInterval: 300,
    cnbAutoStop: false,
    cnbAutoStopDelay: 30,
    showTopNavIcon: false,
};

const EXPANSION_SYSTEM_PROMPT = `You are an expert Stable Diffusion prompt engineer specializing in anime-style image generation using the Animagine XL 3.1 model. Your task is to convert a Chinese scene description into optimized English Danbooru-style tags.

CRITICAL RULES:
- Output ONLY comma-separated tags. NO explanations, NO categories, NO labels, NO colons, NO markdown, NO line breaks
- Start with subject count tag: "1girl" or "1boy" or "1other" or "multiple_girls" etc.
- Every tag must use underscores for spaces: "red_silk_dress" not "red silk dress"
- No Chinese characters in output
- No nsfw tags in output
- Do NOT include quality tags (masterpiece, best quality, etc.) - they are added automatically
- Do NOT repeat tags from the character reference - only add NEW scene-specific tags

REQUIRED TAG CATEGORIES (you must include at least one tag from EACH):
1. ACTION/POSE: What is the character doing? (sitting, standing, walking, leaning_forward, arms_behind_back, hand_on_hip, looking_back, reaching_out, etc.)
2. CLOTHING DETAILS: Specific clothing for THIS scene (not from reference) (unbuttoned_shirt, lifted_skirt, loose_robe, wet_clothes, etc.)
3. EXPRESSION: Facial expression for THIS moment (blush, shy_smile, teary_eyes, biting_lip, surprised, aroused_expression, etc.)
4. CAMERA: Shot type and angle (close-up, upper_body, full_body, from_above, from_below, from_side, dutch_angle, pov, wide_shot, etc.)
5. SETTING: Where does this take place? (bedroom, kitchen, bathroom, classroom, office, living_room, garden, street, etc.)
6. LIGHTING: Light quality and direction (warm_lighting, moonlight, backlighting, dim_lighting, sunlight_through_window, neon_lights, candlelight, etc.)

ANIMAGINE XL 3.1 SPECIFIC:
- Use "anime_style" tag for consistent anime look
- Use "year_2024" for modern quality boost
- Character tags should follow: identifier, age_group, hair_style, hair_color, eye_color, body_type
- Scene composition tags: "solo_focus" for single character emphasis, "depth_of_field" for bokeh

EXAMPLE OUTPUT:
1girl, sitting_on_bed, unbuttoned_white_shirt, blush, shy_expression, close-up, from_above, bedroom, warm_lighting, messy_hair, looking_at_viewer, soft_smile, night, lamp_light, rumpled_sheets`;

const REALISTIC_SYSTEM_PROMPT = `You are an expert Stable Diffusion prompt engineer specializing in photorealistic image generation using SDXL models like Juggernaut XL. Your task is to convert a Chinese scene description into optimized English tags for realistic photography.

CRITICAL RULES:
- Output ONLY comma-separated tags. NO explanations, NO categories, NO labels, NO colons, NO markdown, NO line breaks
- Start with subject count: "1girl" or "1boy" or "1other" etc.
- Every tag must use underscores for spaces: "red_silk_dress" not "red silk dress"
- No Chinese characters in output
- No nsfw tags in output
- Do NOT include quality tags (masterpiece, best quality, etc.) - they are added automatically
- Do NOT repeat tags from the character reference - only add NEW scene-specific tags

REQUIRED TAG CATEGORIES (you must include at least one tag from EACH):
1. ACTION/POSE: What is the character doing? (sitting, standing, walking, leaning_forward, etc.)
2. CLOTHING DETAILS: Specific clothing for THIS scene (unbuttoned_shirt, dress, suit, etc.)
3. EXPRESSION: Facial expression (smile, serious, surprised, etc.)
4. CAMERA: Shot type and angle (close-up, upper_body, full_body, from_above, from_below, etc.)
5. SETTING: Where does this take place? (bedroom, kitchen, office, street, etc.)
6. LIGHTING: Light quality and direction (warm_lighting, moonlight, natural_light, studio_lighting, etc.)

REALISTIC STYLE SPECIFIC:
- Use "photorealistic", "raw_photo", "8k" for realistic look
- Use "film_grain", "depth_of_field", "bokeh" for photographic quality
- Avoid anime/manga style tags
- Focus on natural lighting and realistic textures

EXAMPLE OUTPUT:
1girl, sitting_on_sofa, white_shirt, gentle_smile, upper_body, from_front, living_room, warm_natural_light, soft_focus, bookshelf_background, afternoon_sunlight`;

function getExpansionSystemPrompt() {
    const settings = getSettings();
    const style = settings.style || 'anime';
    const realisticStyles = ['realistic', 'cinematic', 'portrait'];
    return realisticStyles.includes(style) ? REALISTIC_SYSTEM_PROMPT : EXPANSION_SYSTEM_PROMPT;
}

const EXPANSION_USER_TEMPLATE = `Convert this Chinese scene description into detailed SD tags. The character reference tags are provided as BASE appearance - you must ADD scene-specific tags for action, clothing state, expression, camera angle, setting, and lighting that match THIS specific scene.

Chinese scene: {description}
Character base tags: {charPrompt}

Scene-specific SD tags (MUST include: action/pose, clothing details, expression, camera angle, setting, lighting):`;

const QUALITY_ELEMENTS = [
    { key: 'subject', label: '主体', patterns: [/1girl|1boy|1other|multiple_girls|multiple_boys|solo|couple/i] },
    { key: 'action', label: '动作', patterns: [/sitting|standing|lying|walking|leaning|kneeling|bending|reaching|running|jumping|pose|hand|arm|leg/i] },
    { key: 'clothing', label: '衣着', patterns: [/dress|skirt|shirt|pants|uniform|costume|outfit|clothing|wear|apron|hoodie|suit|jacket|robe|underwear|bra|panties/i] },
    { key: 'expression', label: '表情', patterns: [/smile|frown|grin|blush|expression|emotion|shy|angry|surprised|gaze|look|teary|biting|aroused/i] },
    { key: 'camera', label: '视角', patterns: [/close-up|upper_body|full_body|from_above|from_below|from_side|pov|wide_shot|portrait|dutch_angle|cowboy_shot/i] },
    { key: 'setting', label: '环境', patterns: [/room|outdoor|indoor|street|cafe|forest|sky|building|bed|kitchen|bathroom|office|shop|garden|classroom|bedroom/i] },
    { key: 'lighting', label: '光线', patterns: [/light|shadow|sunlight|moonlight|lamp|glow|dim|bright|neon|warm_lighting|backlight|candlelight/i] },
];

const CHINESE_QUALITY_ELEMENTS = [
    { key: 'subject', label: '主体', patterns: [/女|男|人|少女|少妇|御姐|萝莉|角色|人物|女孩|男孩|女人|男人|姐姐|妹妹|妈妈|阿姨|老师|学生|妻子|母亲/i] },
    { key: 'action', label: '动作', patterns: [/坐|站|躺|走|跑|跪|弯|靠|抱|牵|举|伸|扭|转|低|抬|倚|卧|趴/i] },
    { key: 'clothing', label: '衣着', patterns: [/裙|衣|裤|衫|袍|服|装|袜|鞋|帽|围巾|领带|内衣|睡衣|旗袍|校服|制服|浴衣|和服/i] },
    { key: 'expression', label: '表情', patterns: [/笑|哭|脸|红|羞|怒|惊|呆|咬|皱|眯|凝|望|看|瞪|嘟|喘|呻|娇/i] },
    { key: 'camera', label: '视角', patterns: [/特写|近景|中景|全景|远景|俯视|仰视|侧|正面|背面|半身|全身|头像|视角|镜头/i] },
    { key: 'setting', label: '环境', patterns: [/房|室|厅|厨|浴|园|街|路|林|山|水|海|天|窗|床|桌|椅|沙发|门|墙|楼/i] },
    { key: 'lighting', label: '光线', patterns: [/光|影|阳|月|灯|烛|暗|明|昏|亮|霞|辉|芒|晕|照|映/i] },
];

let cachedOllamaModels = null;
let cachedRemoteApiModels = null;
let cachedComfyWorkflows = null;
const generatedTagKeys = new Set();
const processingMessages = new Map();

const cnbServiceState = {
    status: 'unknown',
    lastCheck: null,
    lastWake: null,
    isWaking: false,
    wakePromise: null,
    keepAliveTimer: null,
    pollTimer: null,
    consecutiveFailures: 0,
    workspaceSn: null,
    pipelineId: null,
    autoStopTimer: null,
    lastActivity: null,
};

async function cnbCheckComfyStatus(comfyUrl) {
    const url = (comfyUrl || extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188').replace(/\/+$/, '');

    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${url}/system_stats`, {
                method: 'GET',
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (response.ok) {
                const data = await response.json();
                return { online: true, data: data };
            }
            return { online: false, data: null, error: `HTTP ${response.status}` };
        } catch (e) {
            return { online: false, data: null, error: e.message };
        }
    }

    if (url.startsWith('https://cnb.cool/')) {
        try {
            const result = await cnbApiCall('/comfyui-proxy/system_stats', { timeout: 15000 });
            return { online: true, data: result };
        } catch (e) {
            return { online: false, data: null, error: `CNB代理访问失败: ${e.message}` };
        }
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${url}/system_stats`, {
            method: 'GET',
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            return { online: true, data: data };
        }
        return { online: false, data: null };
    } catch (e) {
        return { online: false, data: null, error: e.message };
    }
}

async function cnbCheckWorkspaceStatus() {
    const settings = getSettings();
    if (!settings.cnbApiToken || !settings.cnbRepoPath) {
        return { running: false, comfyProxyUrl: null, proxyRequiresAuth: false, forwardedAddress: null, forwardedAddressReachable: false, localTunnelUrl: null };
    }

    try {
        const result = await cnbApiCall(`/workspace-status?repo=${encodeURIComponent(settings.cnbRepoPath)}`);
        if (result.status === 'running' && result.workspace) {
            cnbServiceState.workspaceSn = result.workspace.sn;
            cnbServiceState.pipelineId = result.workspace.pipelineId;
            return { running: true, comfyProxyUrl: result.comfyProxyUrl, proxyRequiresAuth: !!result.proxyRequiresAuth, forwardedAddress: result.forwardedAddress || null, forwardedAddressReachable: !!result.forwardedAddressReachable, localTunnelUrl: result.localTunnelUrl, workspace: result.workspace, detail: result.detail };
        }
        return { running: false, comfyProxyUrl: null, proxyRequiresAuth: false, forwardedAddress: null, forwardedAddressReachable: false, localTunnelUrl: null };
    } catch (e) {
        console.warn('[Story-Images CNB] Check workspace status failed:', e.message);
        return { running: false, comfyProxyUrl: null, proxyRequiresAuth: false, forwardedAddress: null, forwardedAddressReachable: false, localTunnelUrl: null, error: e.message };
    }
}

const CNB_API_BASE = 'https://api.cnb.cool';

let _cnbPluginAvailable = null;
let _cnbCorsProxyAvailable = null;
let _cnbCorsAuthMode = null;

function encodeRepoPath(repo) {
    return repo.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

async function cnbDetectCorsAuthMode() {
    if (_cnbCorsAuthMode !== null) return _cnbCorsAuthMode;
    const settings = getSettings();
    const token = settings.cnbApiToken;
    if (!token) return null;

    try {
        const headers = {
            ...getRequestHeaders(),
            'X-Target-Authorization': `Bearer ${token}`,
        };
        delete headers['Authorization'];
        delete headers['authorization'];
        const response = await fetch('/proxy/https://api.cnb.cool/', {
            method: 'HEAD',
            headers,
        });
        if (response.status === 401 || response.status === 403) {
            // x-target didn't work, try direct
        } else if (response.status !== 404) {
            _cnbCorsAuthMode = 'x-target';
            return 'x-target';
        }
    } catch {}

    try {
        const headers = {
            ...getRequestHeaders(),
            'Authorization': `Bearer ${token}`,
        };
        const response = await fetch('/proxy/https://api.cnb.cool/', {
            method: 'HEAD',
            headers,
        });
        if (response.status !== 404 && response.status !== 401 && response.status !== 403) {
            _cnbCorsAuthMode = 'direct';
            return 'direct';
        }
    } catch {}

    return null;
}

function cnbResetAuthCache() {
    _cnbCorsAuthMode = null;
    _cnbCorsProxyAvailable = null;
}

async function cnbCheckCorsProxyAvailable() {
    if (_cnbCorsProxyAvailable !== null) return _cnbCorsProxyAvailable;
    try {
        const response = await fetch('/proxy/https://api.cnb.cool/', {
            method: 'GET',
            headers: { ...getRequestHeaders() },
        });
        _cnbCorsProxyAvailable = response.status !== 404;
    } catch {
        _cnbCorsProxyAvailable = false;
    }
    return _cnbCorsProxyAvailable;
}

async function cnbCheckPluginAvailable() {
    if (_cnbPluginAvailable !== null) return _cnbPluginAvailable;
    try {
        const response = await fetch('/api/plugins/sillytavern-image-assistant/test-token', {
            method: 'GET',
            headers: getRequestHeaders(),
        });
        const text = await response.text();
        if (text.startsWith('<!') || text.startsWith('<html') || text.startsWith('<HTML')) {
            _cnbPluginAvailable = false;
        } else {
            _cnbPluginAvailable = response.ok || response.status === 400;
        }
    } catch {
        _cnbPluginAvailable = false;
    }
    return _cnbPluginAvailable;
}

async function cnbFetchViaCorsProxy(apiPath, options = {}) {
    const settings = getSettings();
    const token = settings.cnbApiToken;
    if (!token) throw new Error('CNB API Token未配置');

    const authMode = await cnbDetectCorsAuthMode();

    const fullUrl = `${CNB_API_BASE}${apiPath}`;

    async function doFetch(mode) {
        const controller = new AbortController();
        const timeoutMs = options.timeout || 15000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const headers = {
                ...getRequestHeaders(),
                'Accept': 'application/json',
            };

            if (mode === 'direct') {
                headers['Authorization'] = `Bearer ${token}`;
            } else {
                delete headers['Authorization'];
                delete headers['authorization'];
                headers['X-Target-Authorization'] = `Bearer ${token}`;
            }

            if (options.method && !['GET', 'HEAD'].includes(options.method)) {
                headers['Content-Type'] = 'application/json';
            }

            const response = await fetch(`/proxy/${fullUrl}`, {
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                if (text.startsWith('<!') || text.startsWith('<html') || text.startsWith('<HTML')) {
                    _cnbCorsProxyAvailable = false;
                    throw new Error('CORS_PROXY_ERROR');
                }
                throw new Error(`CNB API响应不是有效的JSON格式 (${response.status})`);
            }
            if (!response.ok) {
                const err = new Error(data.message || data.error || `CNB API错误 (${response.status})`);
                err.status = response.status;
                throw err;
            }
            return data;
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') {
                throw new Error('请求超时');
            }
            throw e;
        }
    }

    try {
        return await doFetch(authMode || 'x-target');
    } catch (e) {
        if (e.status === 401 || e.status === 403) {
            const otherMode = (authMode || 'x-target') === 'x-target' ? 'direct' : 'x-target';
            cnbResetAuthCache();
            try {
                const result = await doFetch(otherMode);
                _cnbCorsAuthMode = otherMode;
                return result;
            } catch (retryErr) {
                if (retryErr.status === 401 || retryErr.status === 403) {
                    throw new Error('CNB API认证失败，请检查Token是否有效');
                }
                throw retryErr;
            }
        }
        throw e;
    }
}

async function cnbProxyApiCall(endpoint, options = {}) {
    const settings = getSettings();
    const token = settings.cnbApiToken;
    if (!token) throw new Error('CNB API Token未配置');

    if (await cnbCheckPluginAvailable()) {
        const controller = new AbortController();
        const timeoutMs = options.timeout || 15000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`/api/plugins/sillytavern-image-assistant${endpoint}`, {
            method: options.method || 'GET',
            headers: getRequestHeaders(),
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            if (text.startsWith('<!') || text.startsWith('<html') || text.startsWith('<HTML')) {
                _cnbPluginAvailable = false;
                return cnbProxyApiCall(endpoint, options);
            }
            throw new Error(`API响应不是有效的JSON格式 (${response.status})`);
        }
        if (!response.ok) {
            throw new Error(data.error || data.message || `API错误 (${response.status})`);
        }
        return data;
    }

    const apiMapping = cnbGetEndpointMapping(endpoint, options, settings);
    if (!apiMapping) {
        cnbShowPluginRequiredGuide();
        throw new Error('此功能需要安装CNB后端插件（SSH隧道等服务器端操作无法在浏览器中执行）');
    }

    if (await cnbCheckCorsProxyAvailable()) {
        const rawData = await cnbFetchViaCorsProxy(apiMapping.path, {
            method: apiMapping.method || options.method,
            body: apiMapping.body || options.body,
            timeout: options.timeout,
        });
        return apiMapping.transform ? apiMapping.transform(rawData) : rawData;
    }

    cnbShowCorsProxyGuide();
    throw new Error('CORS代理未启用或认证模式不兼容。请在config.yaml中设置 enableCorsProxy: true 后重启SillyTavern。如已启用仍失败，请运行安装脚本: node public/scripts/extensions/third-party/sillytavern-image-assistant/install.mjs');
}

function cnbGetEndpointMapping(endpoint, options, settings) {
    if (endpoint === '/test-token') {
        return {
            path: '/user',
            method: 'GET',
            transform: (data) => ({
                valid: true,
                status: 200,
                message: 'Token验证成功',
                username: data.username || null,
                nickname: data.nickname || null,
            }),
        };
    }

    if (endpoint.startsWith('/validate-repo')) {
        const repo = new URLSearchParams(endpoint.split('?')[1] || '').get('repo');
        if (!repo) return null;
        const validation = cnbValidateRepoPath(repo);
        if (!validation.valid) {
            return {
                path: `/${encodeRepoPath(validation.normalized || repo)}`,
                method: 'GET',
                transform: () => ({
                    valid: false,
                    exists: false,
                    error: validation.error,
                }),
            };
        }
        return {
            path: `/${encodeRepoPath(validation.normalized)}`,
            method: 'GET',
            transform: (data) => ({
                valid: true,
                exists: true,
                path: data.path,
                name: data.name,
                description: (data.description || '').substring(0, 100),
                defaultBranch: data.default_branch || 'main',
                webUrl: data.web_url,
            }),
        };
    }

    if (endpoint.startsWith('/repos')) {
        const params = new URLSearchParams(endpoint.split('?')[1] || '');
        const page = params.get('page') || '1';
        const pageSize = params.get('page_size') || '50';
        return {
            path: `/user/repos?page=${page}&page_size=${pageSize}`,
            method: 'GET',
            transform: (data) => {
                const repos = Array.isArray(data) ? data : (data?.list || []);
                return {
                    repos: repos.map(r => ({
                        path: r.path || r.full_path || r.path_with_namespace || `${r.namespace?.path || ''}/${r.name}`,
                        name: r.name,
                        description: r.description || '',
                        defaultBranch: r.default_branch || 'main',
                        visibility: r.visibility_level || r.visibility || '',
                        updatedAt: r.updated_at || '',
                    })),
                    total: data?.total || repos.length,
                };
            },
        };
    }

    if (endpoint.startsWith('/branches')) {
        const params = new URLSearchParams(endpoint.split('?')[1] || '');
        const repo = params.get('repo');
        if (!repo) return null;
        const page = params.get('page') || '1';
        const pageSize = params.get('page_size') || '50';
        return {
            path: `/${encodeRepoPath(repo)}/-/git/branches?page=${page}&page_size=${pageSize}`,
            method: 'GET',
            transform: (data) => {
                const branches = Array.isArray(data) ? data : (data?.list || []);
                return {
                    branches: branches.map(b => ({
                        name: b.name,
                        isDefault: b.is_default || false,
                        updatedAt: b.commit?.committed_date || b.updated_at || '',
                    })),
                };
            },
        };
    }

    if (endpoint.startsWith('/workspace-status')) {
        const params = new URLSearchParams(endpoint.split('?')[1] || '');
        const repo = params.get('repo');
        if (!repo) return null;
        const validation = cnbValidateRepoPath(repo);
        if (!validation.valid) return null;
        return {
            path: `/workspace/list?slug=${encodeURIComponent(validation.normalized)}&page=1&page_size=10`,
            method: 'GET',
            transform: (data) => {
                const workspaces = Array.isArray(data) ? data : (data?.list || []);
                const ws = workspaces.find(w => w.status?.toLowerCase() === 'running') || null;
                if (!ws) {
                    return { status: 'offline', workspace: null, comfyProxyUrl: null, localTunnelUrl: null };
                }
                return {
                    status: ws.status?.toLowerCase() || 'unknown',
                    workspace: {
                        sn: ws.sn,
                        pipelineId: ws.pipeline_id,
                        branch: ws.branch,
                        createTime: ws.create_time,
                        duration: ws.duration,
                        repoUrl: ws.repo_url,
                    },
                    detail: null,
                    comfyProxyUrl: null,
                    localTunnelUrl: null,
                };
            },
        };
    }

    if (endpoint === '/start' && options.method === 'POST') {
        const repo = options.body?.repo || settings.cnbRepoPath;
        if (!repo) return null;
        const validation = cnbValidateRepoPath(repo);
        if (!validation.valid) return null;
        return {
            path: `/${encodeRepoPath(validation.normalized)}/-/workspace/start`,
            method: 'POST',
            body: { branch: options.body?.branch || settings.cnbBranch || 'main' },
            timeout: 60000,
        };
    }

    if (endpoint === '/stop' && options.method === 'POST') {
        return {
            path: '/workspace/stop',
            method: 'POST',
            body: options.body,
        };
    }

    if (endpoint === '/delete' && options.method === 'POST') {
        return {
            path: '/workspace/delete',
            method: 'POST',
            body: options.body,
        };
    }

    if (endpoint.startsWith('/list')) {
        const params = new URLSearchParams(endpoint.split('?')[1] || '');
        const qs = params.toString();
        return {
            path: `/workspace/list${qs ? '?' + qs : ''}`,
            method: 'GET',
        };
    }

    if (endpoint.startsWith('/build-status')) {
        const parts = endpoint.replace('/build-status/', '').split('/');
        if (parts.length < 2) return null;
        const repo = decodeURIComponent(parts[0]);
        const sn = parts[1];
        return {
            path: `/${encodeRepoPath(repo)}/-/build/status/${sn}`,
            method: 'GET',
        };
    }

    if (endpoint.startsWith('/setup-tunnel') || endpoint.startsWith('/ssh-status') || endpoint.startsWith('/setup-ssh') || endpoint.startsWith('/comfyui-proxy')) {
        return null;
    }

    if (endpoint.startsWith('/tunnel')) {
        return null;
    }

    return null;
}

function cnbValidateRepoPath(repo) {
    if (!repo || typeof repo !== 'string') return { valid: false, error: '仓库路径为空' };
    const trimmed = repo.trim();
    if (trimmed !== repo) return { valid: false, error: '仓库路径包含前后空格', normalized: trimmed };
    const parts = trimmed.split('/');
    if (parts.length < 2) return { valid: false, error: '仓库路径格式错误，应为: 组织名/仓库名' };
    if (/[:\s]/.test(trimmed)) return { valid: false, error: '仓库路径包含非法字符（冒号或空格），请确认路径是否正确' };
    return { valid: true, normalized: trimmed };
}

function cnbShowCorsProxyGuide() {
    const statusEl = document.getElementById('si_cnb_status');
    if (statusEl) {
        statusEl.innerHTML = `
            <div style="color: #ff8080; font-size: 11px;">
                <div style="font-weight: bold; margin-bottom: 4px;">⚠️ CORS代理未启用</div>
                <div style="color: #aaa; margin-bottom: 6px;">CNB功能需要CORS代理支持，请按以下步骤启用：</div>
                <div style="color: #ccc; font-family: monospace; font-size: 10px; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; margin-bottom: 6px;">
                    在 SillyTavern 的 <b>config.yaml</b> 中设置：<br>
                    &nbsp;&nbsp;&nbsp;<code style="color: #7fff7f;">enableCorsProxy: true</code><br><br>
                    然后重启 SillyTavern
                </div>
            </div>
        `;
    }
}

function cnbShowPluginRequiredGuide() {
    const statusEl = document.getElementById('si_cnb_status');
    if (statusEl) {
        statusEl.innerHTML = `
            <div style="color: #ff8080; font-size: 11px;">
                <div style="font-weight: bold; margin-bottom: 4px;">⚠️ 此功能需要CNB后端插件</div>
                <div style="color: #aaa; margin-bottom: 6px;">SSH隧道等服务器端操作需要Server Plugin支持：</div>
                <div style="color: #ccc; font-family: monospace; font-size: 10px; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; margin-bottom: 6px;">
                    <b>自动安装（推荐）</b><br>
                    &nbsp;&nbsp;&nbsp;在SillyTavern目录下运行：<br>
                    &nbsp;&nbsp;&nbsp;<code style="color: #7fff7f;">node public/scripts/extensions/third-party/sillytavern-image-assistant/install.mjs</code><br><br>
                    <b>手动安装</b><br>
                    &nbsp;&nbsp;&nbsp;1. 将扩展目录中的 <b>server-plugin/</b> 文件夹<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;复制到 SillyTavern 的 <b>plugins/sillytavern-image-assistant/</b><br><br>
                    &nbsp;&nbsp;&nbsp;2. 在 <b>config.yaml</b> 中设置：<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<code>enableServerPlugins: true</code><br><br>
                    &nbsp;&nbsp;&nbsp;3. 重启 SillyTavern
                </div>
                <div style="color: #888; font-size: 10px;">安装后端插件后可使用SSH隧道等完整功能</div>
            </div>
        `;
    }
}

async function cnbApiCall(endpoint, options = {}) {
    try {
        return await cnbProxyApiCall(endpoint, options);
    } catch (e) {
        if (e.message === 'CORS_PROXY_ERROR') {
            _cnbCorsProxyAvailable = null;
            _cnbCorsAuthMode = null;
            try {
                return await cnbProxyApiCall(endpoint, options);
            } catch (retryErr) {
                console.error(`[Story-Images CNB] API call failed after retry: ${endpoint}`, retryErr);
                throw retryErr;
            }
        }
        console.error(`[Story-Images CNB] API call failed: ${endpoint}`, e);
        throw e;
    }
}

async function cnbWakeService() {
    const settings = getSettings();
    if (!settings.cnbEnabled) {
        console.warn('[Story-Images CNB] CNB not enabled');
        return false;
    }

    if (cnbServiceState.isWaking && cnbServiceState.wakePromise) {
        console.log('[Story-Images CNB] Wake already in progress, waiting...');
        return cnbServiceState.wakePromise;
    }

    cnbServiceState.isWaking = true;
    cnbServiceState.status = 'waking';

    cnbServiceState.wakePromise = (async () => {
        const comfyUrl = (extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188').replace(/\/+$/, '');
        const timeout = (settings.cnbWakeTimeout || 120) * 1000;
        const pollInterval = (settings.cnbPollInterval || 5) * 1000;

        console.log('[Story-Images CNB] Starting workspace via API...');
        cnbUpdateStatusUI('waking', '正在初始化...', {
            progress: 5,
            stageLabel: '初始化',
            detail: { buildStage: '准备中' },
        });

        try {
            if (settings.cnbApiToken && settings.cnbRepoPath) {
                cnbUpdateStatusUI('waking', '正在发送启动请求...', {
                    progress: 15,
                    stageLabel: '发送启动请求',
                    detail: { branch: settings.cnbBranch || 'main' },
                });

                const result = await cnbApiCall('/start', {
                    method: 'POST',
                    body: {
                        repo: settings.cnbRepoPath,
                        branch: settings.cnbBranch || 'main',
                    },
                });

                if (result.sn) {
                    cnbServiceState.workspaceSn = result.sn;
                }
                if (result.pipelineId) {
                    cnbServiceState.pipelineId = result.pipelineId;
                }

                console.log(`[Story-Images CNB] Workspace start requested: sn=${result.sn || 'N/A'}`);
                cnbUpdateStatusUI('waking', '启动请求已发送，等待环境准备...', {
                    progress: 25,
                    stageLabel: '环境准备中',
                    detail: {
                        workspaceSn: result.sn || '',
                        buildStage: 'prepare',
                    },
                });
            } else {
                throw new Error('请配置CNB API Token和仓库路径');
            }
        } catch (e) {
            console.warn('[Story-Images CNB] Start request error:', e.message);
            showToast(`⚠️ CNB启动请求失败: ${e.message}`, 'error');
            cnbServiceState.status = 'offline';
            cnbServiceState.isWaking = false;
            cnbServiceState.wakePromise = null;
            cnbUpdateStatusUI('offline', `启动失败: ${e.message}`, {
                progress: 0,
                stageLabel: '启动失败',
                detail: { error: e.message },
            });
            return false;
        }

        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            await new Promise(r => setTimeout(r, pollInterval));

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const timeRatio = Math.min(0.85, (Date.now() - startTime) / timeout);
            let progress = 25 + Math.round(timeRatio * 60);
            let stageLabel = '环境准备中';
            let buildStage = 'prepare';

            if (settings.cnbApiToken && settings.cnbRepoPath && cnbServiceState.workspaceSn) {
                try {
                    const buildResult = await cnbApiCall(`/build-status/${encodeURIComponent(settings.cnbRepoPath)}/${cnbServiceState.workspaceSn}`);
                    const pipeline = buildResult?.pipelinesStatus?.[Object.keys(buildResult?.pipelinesStatus || {})[0]];
                    if (pipeline) {
                        const pStatus = pipeline.status?.toLowerCase();
                        if (pStatus === 'prepare') {
                            const prepareStage = pipeline.stages?.find(s => s.name === 'prepare');
                            if (prepareStage?.status === 'start') {
                                progress = 30 + Math.round(timeRatio * 30);
                                stageLabel = '环境准备中';
                                buildStage = 'prepare';
                            } else if (prepareStage?.status === 'success') {
                                progress = 65;
                                stageLabel = '构建工作空间';
                                buildStage = 'building';
                            }
                        } else if (pStatus === 'running' || pStatus === 'success') {
                            progress = 75;
                            stageLabel = '服务启动中';
                            buildStage = 'starting';
                        }
                    }
                } catch (_) { }
            }

            cnbUpdateStatusUI('waking', `等待服务就绪... (${elapsed}秒)`, {
                progress,
                stageLabel,
                detail: {
                    workspaceSn: cnbServiceState.workspaceSn || '',
                    buildStage,
                    elapsed,
                },
            });

            if (settings.cnbApiToken && settings.cnbRepoPath) {
                const wsStatus = await cnbCheckWorkspaceStatus();
                if (wsStatus.running) {
                    cnbServiceState.status = 'online';
                    cnbServiceState.lastWake = new Date().toISOString();
                    cnbServiceState.consecutiveFailures = 0;
                    cnbServiceState.isWaking = false;
                    cnbServiceState.wakePromise = null;
                    cnbServiceState.lastActivity = new Date().toISOString();

                    cnbUpdateStatusUI('waking', '正在同步ComfyUI配置...', {
                        progress: 95,
                        stageLabel: '同步配置',
                        detail: {
                            workspaceSn: cnbServiceState.workspaceSn || '',
                            branch: wsStatus.workspace?.branch || '',
                        },
                    });

                    await cnbSyncComfyUrl(settings);

                    const comfyUrlNow = extension_settings.sd?.comfy_url || '';
                    console.log('[Story-Images CNB] Workspace is running!');
                    showToast('✅ CNB Workspace已启动! ComfyUI URL已同步', 'success');
                    cnbUpdateStatusUI('online', '服务在线', {
                        progress: 100,
                        stageLabel: '启动完成',
                        detail: {
                            workspaceSn: cnbServiceState.workspaceSn || '',
                            branch: wsStatus.workspace?.branch || '',
                            duration: wsStatus.workspace?.duration || 0,
                            comfyUrl: comfyUrlNow,
                        },
                    });

                    if (settings.cnbKeepAlive) {
                        cnbStartKeepAlive();
                    }
                    cnbResetAutoStopTimer();

                    return true;
                }
            } else {
                const status = await cnbCheckComfyStatus(comfyUrl);
                if (status.online) {
                    cnbServiceState.status = 'online';
                    cnbServiceState.lastWake = new Date().toISOString();
                    cnbServiceState.consecutiveFailures = 0;
                    cnbServiceState.isWaking = false;
                    cnbServiceState.wakePromise = null;
                    cnbServiceState.lastActivity = new Date().toISOString();

                    console.log('[Story-Images CNB] Service is online!');
                    showToast('✅ CNB ComfyUI服务已就绪!', 'success');
                    cnbUpdateStatusUI('online', '服务在线', {
                        progress: 100,
                        stageLabel: '启动完成',
                    });

                    await cnbSyncComfyUrl(settings);

                    if (settings.cnbKeepAlive) {
                        cnbStartKeepAlive();
                    }
                    cnbResetAutoStopTimer();

                    return true;
                }
            }
        }

        cnbServiceState.status = 'offline';
        cnbServiceState.isWaking = false;
        cnbServiceState.wakePromise = null;

        console.error('[Story-Images CNB] Wake timeout');
        showToast('❌ CNB ComfyUI启动超时，请检查服务状态', 'error');
        cnbUpdateStatusUI('offline', '启动超时', {
            progress: 0,
            stageLabel: '超时',
            detail: { error: `等待超过${Math.round(timeout/1000)}秒，服务未就绪` },
        });

        return false;
    })();

    return cnbServiceState.wakePromise;
}

async function cnbStopService() {
    const settings = getSettings();
    if (!settings.cnbApiToken || !settings.cnbRepoPath) {
        showToast('⚠️ 请先配置CNB API Token和仓库路径', 'error');
        return false;
    }

    try {
        cnbUpdateStatusUI('waking', '正在停止服务...', {
            progress: 50,
            stageLabel: '停止中',
            detail: { workspaceSn: cnbServiceState.workspaceSn || '' },
        });
        showToast('🔄 正在停止CNB ComfyUI服务...', 'info');

        const body = {};
        if (cnbServiceState.pipelineId) {
            body.pipelineId = cnbServiceState.pipelineId;
        } else if (cnbServiceState.workspaceSn) {
            body.sn = cnbServiceState.workspaceSn;
        } else {
            const listResult = await cnbApiCall(`/list?slug=${encodeURIComponent(settings.cnbRepoPath)}&page=1&page_size=5`);
            const workspaces = Array.isArray(listResult) ? listResult : (listResult?.list || []);
            const activeWs = workspaces.find(w => w.status?.toLowerCase() === 'running' || w.status?.toLowerCase() === 'preparing');
            if (activeWs) {
                body.pipelineId = activeWs.pipelineId || String(activeWs.id || '');
                body.sn = activeWs.sn || '';
            } else {
                showToast('⚠️ 未找到运行中的Workspace', 'error');
                cnbUpdateStatusUI('offline', '未找到运行中的服务', {
                    detail: { error: '没有运行中的工作空间' },
                });
                return false;
            }
        }

        await cnbApiCall('/stop', { method: 'POST', body });

        cnbStopKeepAlive();
        cnbClearAutoStopTimer();
        cnbServiceState.status = 'offline';
        cnbServiceState.isWaking = false;
        cnbServiceState.wakePromise = null;

        console.log('[Story-Images CNB] Service stopped');
        showToast('✅ CNB ComfyUI服务已停止', 'success');
        cnbUpdateStatusUI('offline', '服务已停止', {
            detail: { workspaceSn: cnbServiceState.workspaceSn || '' },
        });

        return true;
    } catch (e) {
        console.error('[Story-Images CNB] Stop error:', e);
        showToast(`❌ 停止服务失败: ${e.message}`, 'error');
        cnbUpdateStatusUI('offline', '停止失败', {
            detail: { error: e.message },
        });
        return false;
    }
}

async function cnbQueryWorkspaceStatus() {
    const settings = getSettings();
    if (!settings.cnbApiToken || !settings.cnbRepoPath) {
        return null;
    }

    try {
        const result = await cnbApiCall(`/workspace-status?repo=${encodeURIComponent(settings.cnbRepoPath)}`);
        if (result.status === 'running' && result.workspace) {
            cnbServiceState.workspaceSn = result.workspace.sn || cnbServiceState.workspaceSn;
            cnbServiceState.pipelineId = result.workspace.pipelineId || cnbServiceState.pipelineId;
            return result.workspace;
        }
        return null;
    } catch (e) {
        console.warn('[Story-Images CNB] Query workspace status failed:', e.message);
        return null;
    }
}

function cnbResetAutoStopTimer() {
    const settings = getSettings();
    cnbClearAutoStopTimer();

    if (!settings.cnbAutoStop || !settings.cnbEnabled) return;

    const delayMinutes = settings.cnbAutoStopDelay || 30;
    cnbServiceState.autoStopTimer = setTimeout(async () => {
        console.log(`[Story-Images CNB] Auto-stop triggered after ${delayMinutes} minutes of inactivity`);
        showToast(`⏱️ CNB服务已空闲${delayMinutes}分钟，自动停止中...`, 'info');
        await cnbStopService();
    }, delayMinutes * 60 * 1000);

    cnbServiceState.lastActivity = new Date().toISOString();
}

function cnbClearAutoStopTimer() {
    if (cnbServiceState.autoStopTimer) {
        clearTimeout(cnbServiceState.autoStopTimer);
        cnbServiceState.autoStopTimer = null;
    }
}

async function cnbTestApiToken() {
    const settings = getSettings();
    if (!settings.cnbApiToken) {
        showToast('⚠️ 请先填写CNB API Token', 'error');
        return;
    }

    try {
        const result = await cnbApiCall('/test-token');
        if (result.valid) {
            showToast('✅ CNB API Token验证成功!', 'success');
            await cnbFetchRepos();
        } else {
            showToast(`❌ Token验证失败: ${result.message}`, 'error');
        }
    } catch (e) {
        showToast(`❌ Token验证失败: ${e.message}`, 'error');
    }
}

async function cnbFetchRepos() {
    const settings = getSettings();
    if (!settings.cnbApiToken) return;

    try {
        const result = await cnbApiCall('/repos?page=1&page_size=50');
        const repos = result.repos || [];
        const selectEl = document.getElementById('si_cnb_repo_select');
        if (!selectEl) return;

        selectEl.innerHTML = '<option value="">-- 请选择仓库 --</option>';
        for (const repo of repos) {
            const option = document.createElement('option');
            option.value = repo.path;
            option.textContent = `${repo.path}${repo.description ? '  (' + repo.description.substring(0, 25) + '...)' : ''}`;
            option.dataset.defaultBranch = repo.defaultBranch;
            if (repo.path === settings.cnbRepoPath) option.selected = true;
            selectEl.appendChild(option);
        }

        const customOption = document.createElement('option');
        customOption.value = '__custom__';
        customOption.textContent = '✏️ 手动输入...';
        selectEl.appendChild(customOption);

        selectEl.style.display = 'block';
        const textInput = document.getElementById('si_cnb_repo_path');
        if (textInput && settings.cnbRepoPath && !repos.some(r => r.path === settings.cnbRepoPath)) {
            textInput.style.display = 'block';
            selectEl.value = '__custom__';
        } else if (textInput) {
            textInput.style.display = settings.cnbRepoPath && !repos.some(r => r.path === settings.cnbRepoPath) ? 'block' : 'none';
        }

        showToast(`✅ 已加载 ${repos.length} 个仓库`, 'success');

        if (settings.cnbRepoPath) {
            await cnbFetchBranches(settings.cnbRepoPath);
        }
    } catch (e) {
        console.error('[Story-Images CNB] Fetch repos failed:', e);
        showToast(`⚠️ 获取仓库列表失败: ${e.message}`, 'error');
    }
}

async function cnbFetchBranches(repoPath) {
    if (!repoPath || repoPath === '__custom__') return;

    const settings = getSettings();
    if (!settings.cnbApiToken) return;

    try {
        const result = await cnbApiCall(`/branches?repo=${encodeURIComponent(repoPath)}&page=1&page_size=50`);
        const branches = result.branches || [];
        const selectEl = document.getElementById('si_cnb_branch_select');
        if (!selectEl) return;

        selectEl.innerHTML = '<option value="">-- 请选择分支 --</option>';
        for (const branch of branches) {
            const option = document.createElement('option');
            option.value = branch.name;
            option.textContent = `${branch.name}${branch.isDefault ? ' (默认)' : ''}`;
            if (branch.name === settings.cnbBranch || (branch.isDefault && !settings.cnbBranch)) {
                option.selected = true;
            }
            selectEl.appendChild(option);
        }

        const customOption = document.createElement('option');
        customOption.value = '__custom__';
        customOption.textContent = '✏️ 手动输入...';
        selectEl.appendChild(customOption);

        selectEl.style.display = 'block';
        const textInput = document.getElementById('si_cnb_branch');
        if (textInput) textInput.style.display = 'none';

        if (branches.length > 0 && !settings.cnbBranch) {
            const defaultBranch = branches.find(b => b.isDefault);
            if (defaultBranch) {
                settings.cnbBranch = defaultBranch.name;
                saveSettingsDebounced();
            }
        }
    } catch (e) {
        console.error('[Story-Images CNB] Fetch branches failed:', e);
        showToast(`⚠️ 获取分支列表失败: ${e.message}`, 'error');
    }
}

async function testComfyUrlReachability(url) {
    if (!url || typeof url !== 'string') return { reachable: false, reason: 'empty URL' };
    const normalized = url.replace(/\/+$/, '');
    try {
        const resp = await fetch(`${normalized}/system_stats`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
        });
        if (resp.status === 401 || resp.status === 403) {
            return { reachable: false, reason: `auth-required`, status: resp.status };
        }
        if (resp.ok || resp.status === 200) {
            return { reachable: true, status: resp.status };
        }
        return { reachable: false, reason: `http-${resp.status}`, status: resp.status };
    } catch (e) {
        return { reachable: false, reason: e.name === 'TimeoutError' ? 'timeout' : e.message };
    }
}

async function cnbSyncComfyUrl(settings) {
    if (!settings.cnbApiToken || !settings.cnbRepoPath) return;

    try {
        const wsStatus = await cnbCheckWorkspaceStatus();
        if (!wsStatus.running || !wsStatus.workspace) {
            console.log('[Story-Images CNB] No active workspace found for URL sync');
            return;
        }

        let comfyUrl = null;
        let urlSource = '';

        if (wsStatus.forwardedAddress) {
            comfyUrl = wsStatus.forwardedAddress.replace(/\/+$/, '');
            urlSource = 'Forwarded Address (cnb.run)';
            console.log('[Story-Images CNB] Checking Forwarded Address:', comfyUrl);

            let isReachable = wsStatus.forwardedAddressReachable;
            if (!isReachable) {
                isReachable = (await testComfyUrlReachability(comfyUrl)).reachable;
            }

            if (isReachable) {
                console.log('[Story-Images CNB] Forwarded Address is reachable ✓');
            } else {
                console.log('[Story-Images CNB] Forwarded Address not yet reachable, waiting for ComfyUI to fully start...');
                comfyUrl = null;

                const maxWait = 120;
                const pollInterval = 5;
                let waited = 0;
                showToast('⏳ ComfyUI正在启动中，等待Forwarded Address就绪...', 'info');

                while (waited < maxWait) {
                    await new Promise(r => setTimeout(r, pollInterval * 1000));
                    waited += pollInterval;

                    const recheck = await cnbCheckWorkspaceStatus();
                    if (!recheck.running) {
                        console.log('[Story-Images CNB] Workspace stopped while waiting for ComfyUI');
                        showToast('⚠️ CNB工作空间已停止', 'error');
                        return;
                    }

                    if (recheck.forwardedAddressReachable) {
                        comfyUrl = (recheck.forwardedAddress || wsStatus.forwardedAddress).replace(/\/+$/, '');
                        urlSource = `Forwarded Address (waited ${waited}s)`;
                        console.log(`[Story-Images CNB] Forwarded Address is reachable after ${waited}s ✓`);
                        showToast(`✅ ComfyUI已就绪 (等待${waited}秒)`, 'success');
                        break;
                    }

                    const fwdUrl = (recheck.forwardedAddress || wsStatus.forwardedAddress).replace(/\/+$/, '');
                    const reReachability = await testComfyUrlReachability(fwdUrl);
                    if (reReachability.reachable) {
                        comfyUrl = fwdUrl;
                        urlSource = `Forwarded Address (waited ${waited}s)`;
                        console.log(`[Story-Images CNB] Forwarded Address is reachable after ${waited}s ✓`);
                        showToast(`✅ ComfyUI已就绪 (等待${waited}秒)`, 'success');
                        break;
                    }
                    console.log(`[Story-Images CNB] Still waiting... (${waited}s/${maxWait}s) - ${reReachability.reason}`);
                }

                if (!comfyUrl) {
                    console.log(`[Story-Images CNB] Forwarded Address still not reachable after ${maxWait}s, will use fallback`);
                    showToast(`⚠️ ComfyUI启动超时(${maxWait}s)，尝试备用连接`, 'info');
                }
            }
        }

        if (!comfyUrl && wsStatus.localTunnelUrl) {
            comfyUrl = wsStatus.localTunnelUrl;
            urlSource = 'SSH Tunnel';
            console.log('[Story-Images CNB] Using existing SSH tunnel URL:', comfyUrl);
        }

        if (!comfyUrl && wsStatus.comfyProxyUrl && !wsStatus.proxyRequiresAuth) {
            comfyUrl = wsStatus.comfyProxyUrl;
            urlSource = 'CNB Web Proxy';
            console.log('[Story-Images CNB] Fallback to CNB web proxy URL:', comfyUrl);
        }

        if (!comfyUrl && wsStatus.forwardedAddress) {
            comfyUrl = wsStatus.forwardedAddress.replace(/\/+$/, '');
            urlSource = 'Forwarded Address (unreachable, best-effort)';
            console.log('[Story-Images CNB] Using Forwarded Address despite reachability check:', comfyUrl);
        }

        if (comfyUrl && typeof comfyUrl === 'string') {
            comfyUrl = comfyUrl.replace(/\/+$/, '');

            const sd = extension_settings.sd;
            if (sd) {
                const oldUrl = sd.comfy_url || '';
                const oldSource = sd.source || '';
                sd.comfy_url = comfyUrl;
                if (sd.source !== 'comfy') {
                    sd.source = 'comfy';
                    const sourceSelect = document.getElementById('sd_source');
                    if (sourceSelect) sourceSelect.value = 'comfy';
                    console.log(`[Story-Images CNB] Auto-set SD source: ${oldSource} → comfy`);
                }
                saveSettingsDebounced();

                const comfyUrlInput = document.getElementById('comfy_url');
                if (comfyUrlInput) comfyUrlInput.value = comfyUrl;

                console.log(`[Story-Images CNB] Auto-synced ComfyUI URL (${urlSource}): ${oldUrl} → ${comfyUrl}`);
                showToast(`🔗 ComfyUI URL已自动同步 (${urlSource}): ${comfyUrl}`, 'success');
            }
        } else {
            console.log('[Story-Images CNB] Could not determine ComfyUI URL.');
            showToast('⚠️ 无法确定ComfyUI URL，请检查CNB服务状态', 'error');
        }
    } catch (e) {
        console.warn('[Story-Images CNB] Sync ComfyUI URL failed:', e);
    }
}

const CNB_SETUP_STEPS = ['validate', 'start', 'wait', 'tunnel', 'sync', 'test'];

let cnbSetupState = {
    running: false,
    currentStep: null,
    failedStep: null,
    errorMessage: null,
    logs: [],
    retryFromStep: null,
};

function cnbSetupLog(level, message) {
    const ts = new Date().toLocaleTimeString();
    const prefix = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' }[level] || '•';
    cnbSetupState.logs.push({ ts, level, message });
    const logEl = document.getElementById('si_cnb_log');
    if (logEl) {
        const cls = `si-log-${level}`;
        logEl.innerHTML += `<div class="${cls}">[${ts}] ${prefix} ${escapeHtml(message)}</div>`;
        logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(`[Story-Images CNB Setup] ${prefix} ${message}`);
}

function cnbSetupClearLog() {
    cnbSetupState.logs = [];
    const logEl = document.getElementById('si_cnb_log');
    if (logEl) logEl.innerHTML = '';
}

function cnbSetupUpdateStep(stepName, status, subText) {
    const stepEl = document.querySelector(`.si-setup-step[data-step="${stepName}"]`);
    if (!stepEl) return;

    stepEl.classList.remove('si-step-active', 'si-step-done', 'si-step-error', 'si-step-skipped');

    if (status === 'active') {
        stepEl.classList.add('si-step-active');
        const iconEl = stepEl.querySelector('.si-step-icon');
        if (iconEl) iconEl.textContent = '⏳';
    } else if (status === 'done') {
        stepEl.classList.add('si-step-done');
        const iconEl = stepEl.querySelector('.si-step-icon');
        if (iconEl) iconEl.textContent = '✓';
    } else if (status === 'error') {
        stepEl.classList.add('si-step-error');
        const iconEl = stepEl.querySelector('.si-step-icon');
        if (iconEl) iconEl.textContent = '✗';
    } else if (status === 'skipped') {
        stepEl.classList.add('si-step-skipped');
        const iconEl = stepEl.querySelector('.si-step-icon');
        if (iconEl) iconEl.textContent = '⏭';
    }

    if (subText) {
        const subEl = stepEl.querySelector('.si-step-sub');
        if (subEl) subEl.textContent = subText;
    }
}

function cnbSetupResetSteps() {
    const stepNames = CNB_SETUP_STEPS;
    const stepNums = ['1', '2', '3', '4', '5', '6'];
    for (let i = 0; i < stepNames.length; i++) {
        const stepEl = document.querySelector(`.si-setup-step[data-step="${stepNames[i]}"]`);
        if (!stepEl) continue;
        stepEl.classList.remove('si-step-active', 'si-step-done', 'si-step-error', 'si-step-skipped');
        const iconEl = stepEl.querySelector('.si-step-icon');
        if (iconEl) iconEl.textContent = stepNums[i];
    }
}

function cnbSetupShowRetry(show) {
    const retryBtn = document.getElementById('si_cnb_retry');
    if (retryBtn) {
        retryBtn.classList.toggle('si-retry-visible', show);
    }
}

async function cnbAutoSetup(retryFromStep) {
    const settings = getSettings();

    if (cnbSetupState.running) {
        showToast('⚠️ 自动化流程正在执行中，请等待完成', 'warn');
        return false;
    }

    if (!settings.cnbApiToken) {
        showToast('⚠️ 请先配置CNB API Token和仓库路径', 'error');
        return false;
    }

    if (!settings.cnbRepoPath) {
        showToast('⚠️ 请先配置仓库路径（格式：组织名/仓库名）', 'error');
        return false;
    }

    cnbSetupState.running = true;
    cnbSetupState.failedStep = null;
    cnbSetupState.errorMessage = null;
    cnbSetupShowRetry(false);

    const stepsContainer = document.getElementById('si_cnb_steps');
    if (stepsContainer) stepsContainer.style.display = 'block';

    const startBtn = document.getElementById('si_cnb_start_service');
    if (startBtn) startBtn.disabled = true;

    if (!retryFromStep) {
        cnbSetupResetSteps();
        cnbSetupClearLog();
        cnbSetupLog('info', '🚀 开始一键启动流程...');
    } else {
        cnbSetupLog('info', `🔄 从步骤 "${retryFromStep}" 重试...`);
        const retryIdx = CNB_SETUP_STEPS.indexOf(retryFromStep);
        for (let i = retryIdx; i < CNB_SETUP_STEPS.length; i++) {
            const stepEl = document.querySelector(`.si-setup-step[data-step="${CNB_SETUP_STEPS[i]}]`);
            if (stepEl) {
                stepEl.classList.remove('si-step-done', 'si-step-error', 'si-step-skipped');
                const iconEl = stepEl.querySelector('.si-step-icon');
                if (iconEl) iconEl.textContent = String(i + 1);
            }
        }
    }

    const startFrom = retryFromStep ? CNB_SETUP_STEPS.indexOf(retryFromStep) : 0;

    try {
        // Step 1: Validate API Token and Repository
        if (startFrom <= 0) {
            cnbSetupUpdateStep('validate', 'active', '正在验证API Token...');
            cnbSetupLog('info', '验证API Token...');
            cnbUpdateStatusUI('waking', '验证API Token...', { progress: 5, stageLabel: '验证Token' });

            const tokenResult = await cnbApiCall('/test-token');
            if (!tokenResult.valid) {
                throw { step: 'validate', message: `API Token验证失败: ${tokenResult.message || '无效Token'}`, hint: '请在 cnb.cool 个人设置中创建新的访问令牌，确保勾选workspace权限' };
            }
            cnbSetupLog('success', `Token验证成功 (用户: ${tokenResult.username || tokenResult.nickname || '未知'})`);

            if (settings.cnbRepoPath) {
                cnbSetupUpdateStep('validate', 'active', '正在验证仓库可访问性...');
                cnbSetupLog('info', `验证仓库: ${settings.cnbRepoPath}`);
                const repoResult = await cnbApiCall(`/validate-repo?repo=${encodeURIComponent(settings.cnbRepoPath)}`);
                if (!repoResult.valid || !repoResult.exists) {
                    throw { step: 'validate', message: `仓库不可访问: ${repoResult.error || '不存在或无权限'}`, hint: '请确认仓库路径格式正确(组织名/仓库名)且有访问权限' };
                }
                cnbSetupLog('success', `仓库验证成功: ${repoResult.name} (${repoResult.path})`);
            }

            cnbSetupUpdateStep('validate', 'done');
        }

        // Step 2: Start Workspace
        if (startFrom <= 1) {
            cnbSetupUpdateStep('start', 'active', '正在检查工作空间状态...');
            cnbSetupLog('info', '检查现有工作空间...');
            cnbUpdateStatusUI('waking', '启动云开发环境...', { progress: 15, stageLabel: '启动环境' });

            let wsStatus = await cnbCheckWorkspaceStatus();
            if (wsStatus.running) {
                cnbSetupLog('success', `工作空间已在运行 (SN: ${wsStatus.workspace?.sn || 'N/A'})`);
                cnbSetupUpdateStep('start', 'done', '工作空间已运行，跳过启动');
                cnbSetupUpdateStep('wait', 'skipped', '环境已就绪，跳过等待');
            } else {
                cnbSetupUpdateStep('start', 'active', '正在发送启动请求...');
                cnbSetupLog('info', '发送Workspace启动请求...');

                const startResult = await cnbApiCall('/start', {
                    method: 'POST',
                    body: {
                        repo: settings.cnbRepoPath,
                        branch: settings.cnbBranch || 'main',
                    },
                });

                if (startResult.sn) {
                    cnbServiceState.workspaceSn = startResult.sn;
                }
                if (startResult.pipelineId) {
                    cnbServiceState.pipelineId = startResult.pipelineId;
                }

                cnbSetupLog('success', `启动请求已发送 (SN: ${startResult.sn || 'N/A'})`);
                cnbSetupUpdateStep('start', 'done');
            }
        }

        // Step 3: Wait for Environment Ready
        if (startFrom <= 2) {
            const wsStatus2 = await cnbCheckWorkspaceStatus();
            if (wsStatus2.running) {
                if (!document.querySelector('.si-setup-step[data-step="wait"]')?.classList.contains('si-step-skipped')) {
                    cnbSetupUpdateStep('wait', 'done', '环境已就绪');
                }
            } else {
                cnbSetupUpdateStep('wait', 'active', '等待环境构建和启动...');
                cnbSetupLog('info', '等待Workspace构建和服务启动...');
                cnbUpdateStatusUI('waking', '等待环境就绪...', { progress: 30, stageLabel: '等待就绪' });

                const timeout = (settings.cnbWakeTimeout || 120) * 1000;
                const pollInterval = (settings.cnbPollInterval || 5) * 1000;
                const startTime = Date.now();
                let workspaceReady = false;

                while (Date.now() - startTime < timeout) {
                    await new Promise(r => setTimeout(r, pollInterval));
                    const elapsed = Math.round((Date.now() - startTime) / 1000);

                    if (settings.cnbApiToken && settings.cnbRepoPath && cnbServiceState.workspaceSn) {
                        try {
                            const buildResult = await cnbApiCall(`/build-status/${encodeURIComponent(settings.cnbRepoPath)}/${cnbServiceState.workspaceSn}`);
                            const pipeline = buildResult?.pipelinesStatus?.[Object.keys(buildResult?.pipelinesStatus || {})[0]];
                            if (pipeline) {
                                const pStatus = pipeline.status?.toLowerCase();
                                let stageText = '环境准备中';
                                if (pStatus === 'prepare') stageText = '环境准备中';
                                else if (pStatus === 'running') stageText = '服务启动中';
                                else if (pStatus === 'success') stageText = '构建完成';

                                cnbSetupUpdateStep('wait', 'active', `${stageText} (${elapsed}秒)`);
                                const timeRatio = Math.min(0.85, (Date.now() - startTime) / timeout);
                                cnbUpdateStatusUI('waking', `${stageText}... (${elapsed}秒)`, {
                                    progress: 30 + Math.round(timeRatio * 40),
                                    stageLabel: stageText,
                                    detail: { elapsed, workspaceSn: cnbServiceState.workspaceSn || '' },
                                });
                            }
                        } catch (_) { }
                    }

                    const wsCheck = await cnbCheckWorkspaceStatus();
                    if (wsCheck.running) {
                        workspaceReady = true;
                        cnbSetupLog('success', `环境已就绪! (耗时 ${elapsed}秒)`);
                        break;
                    }
                }

                if (!workspaceReady) {
                    throw { step: 'wait', message: `等待超时 (${Math.round(timeout / 1000)}秒)，环境未就绪`, hint: 'CNB冷启动通常需要60-180秒，可尝试增加启动超时时间后重试' };
                }

                cnbSetupUpdateStep('wait', 'done');
            }
        }

        // Step 4: Establish SSH Tunnel
        if (startFrom <= 3) {
            cnbSetupUpdateStep('tunnel', 'active', '正在建立SSH隧道...');
            cnbSetupLog('info', '建立SSH隧道连接...');
            cnbUpdateStatusUI('waking', '建立SSH隧道...', { progress: 80, stageLabel: '建立隧道' });

            let tunnelUrl = null;
            const wsStatus3 = await cnbCheckWorkspaceStatus();
            if (wsStatus3.localTunnelUrl) {
                tunnelUrl = wsStatus3.localTunnelUrl;
                cnbSetupLog('success', `SSH隧道已存在: ${tunnelUrl}`);
            } else {
                try {
                    const tunnelResult = await cnbApiCall('/setup-tunnel', { method: 'POST', timeout: 20000 });
                    if (tunnelResult.localTunnelUrl) {
                        tunnelUrl = tunnelResult.localTunnelUrl;
                        cnbSetupLog('success', `SSH隧道建立成功: ${tunnelUrl}`);
                    }
                } catch (e) {
                    cnbSetupLog('warn', `SSH隧道建立失败: ${e.message}`);
                }
            }

            if (!tunnelUrl) {
                cnbSetupLog('warn', 'SSH隧道不可用，将使用CNB Web代理URL（可能需要浏览器认证）');
                cnbSetupUpdateStep('tunnel', 'skipped', 'SSH隧道不可用，使用Web代理');
            } else {
                cnbSetupUpdateStep('tunnel', 'done', `隧道地址: ${tunnelUrl}`);
            }
        }

        // Step 5: Sync ComfyUI URL
        if (startFrom <= 4) {
            cnbSetupUpdateStep('sync', 'active', '正在提取并同步ComfyUI URL...');
            cnbSetupLog('info', '同步ComfyUI URL到图像生成模块...');
            cnbUpdateStatusUI('waking', '同步ComfyUI URL...', { progress: 90, stageLabel: '同步URL' });

            await cnbSyncComfyUrl(settings);

            const syncedUrl = extension_settings.sd?.comfy_url || '';
            if (syncedUrl) {
                cnbSetupLog('success', `ComfyUI URL已同步: ${syncedUrl}`);
                cnbSetupUpdateStep('sync', 'done', `URL: ${syncedUrl}`);
            } else {
                throw { step: 'sync', message: '无法确定ComfyUI URL', hint: '请检查SSH密钥配置或尝试手动输入URL' };
            }
        }

        // Step 6: Connection Test
        if (startFrom <= 5) {
            cnbSetupUpdateStep('test', 'active', '正在测试ComfyUI连接...');
            cnbSetupLog('info', '测试ComfyUI服务连接...');
            cnbUpdateStatusUI('waking', '测试连接...', { progress: 95, stageLabel: '连接测试' });

            const comfyUrl = extension_settings.sd?.comfy_url || '';
            let testOk = false;
            let testDetail = '';

            if (comfyUrl.startsWith('http://127.0.0.1:') || comfyUrl.startsWith('http://localhost:')) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    const response = await fetch(`${comfyUrl}/system_stats`, {
                        method: 'GET',
                        signal: controller.signal,
                    });
                    clearTimeout(timeoutId);
                    if (response.ok) {
                        const data = await response.json();
                        testOk = true;
                        testDetail = `ComfyUI ${data.system?.comfyui_version || ''} | ${data.devices?.[0]?.name || 'GPU'}`;
                    } else {
                        testDetail = `HTTP ${response.status}`;
                    }
                } catch (e) {
                    testDetail = e.message;
                }
            } else if (comfyUrl.startsWith('https://cnb.cool/')) {
                try {
                    const proxyResult = await cnbApiCall('/comfyui-proxy/system_stats', { timeout: 15000 });
                    testOk = true;
                    testDetail = `ComfyUI ${proxyResult.system?.comfyui_version || ''} (代理)`;
                } catch (e) {
                    testDetail = `代理访问失败: ${e.message}`;
                }
            }

            if (testOk) {
                cnbSetupLog('success', `连接测试成功! ${testDetail}`);
                cnbSetupUpdateStep('test', 'done', testDetail);
            } else {
                cnbSetupLog('warn', `连接测试失败: ${testDetail}（ComfyUI可能仍在启动中）`);
                cnbSetupUpdateStep('test', 'done', '连接测试完成（ComfyUI可能仍在启动中）');
            }
        }

        // Final Success
        cnbServiceState.status = 'online';
        cnbServiceState.lastWake = new Date().toISOString();
        cnbServiceState.consecutiveFailures = 0;
        cnbServiceState.isWaking = false;
        cnbServiceState.wakePromise = null;
        cnbServiceState.lastActivity = new Date().toISOString();

        const finalUrl = extension_settings.sd?.comfy_url || '';
        cnbUpdateStatusUI('online', '服务在线 - 一键启动完成', {
            progress: 100,
            stageLabel: '启动完成',
            detail: {
                comfyUrl: finalUrl,
                workspaceSn: cnbServiceState.workspaceSn || '',
            },
        });

        cnbSetupLog('success', '🎉 一键启动流程完成! ComfyUI已就绪');
        showToast('🎉 CNB ComfyUI一键启动完成!', 'success');

        if (settings.cnbKeepAlive) cnbStartKeepAlive();
        cnbResetAutoStopTimer();

        cnbSetupState.running = false;
        if (startBtn) startBtn.disabled = false;
        return true;

    } catch (err) {
        const step = err.step || CNB_SETUP_STEPS.find(s => {
            const el = document.querySelector(`.si-setup-step[data-step="${s}"]`);
            return el && (el.classList.contains('si-step-active') || !el.classList.contains('si-step-done'));
        }) || 'validate';
        const message = err.message || String(err);
        const hint = err.hint || '';

        cnbSetupState.failedStep = step;
        cnbSetupState.errorMessage = message;

        cnbSetupUpdateStep(step, 'error', message);
        cnbSetupLog('error', `步骤 "${step}" 失败: ${message}`);
        if (hint) cnbSetupLog('warn', `💡 建议: ${hint}`);

        cnbServiceState.status = 'offline';
        cnbServiceState.isWaking = false;
        cnbServiceState.wakePromise = null;

        cnbUpdateStatusUI('offline', `启动失败: ${message}`, {
            progress: 0,
            stageLabel: '启动失败',
            detail: { error: message, hint },
        });

        showToast(`❌ 启动失败: ${message}`, 'error');
        cnbSetupShowRetry(true);

        cnbSetupState.running = false;
        if (startBtn) startBtn.disabled = false;
        return false;
    }
}

async function cnbEnsureServiceReady() {
    const settings = getSettings();
    if (!settings.cnbEnabled) return true;

    if (settings.cnbApiToken && settings.cnbRepoPath) {
        const wsStatus = await cnbCheckWorkspaceStatus();
        if (wsStatus.running) {
            cnbServiceState.status = 'online';
            cnbServiceState.lastCheck = new Date().toISOString();
            cnbServiceState.consecutiveFailures = 0;
            cnbUpdateStatusUI('online', '服务在线');
            cnbResetAutoStopTimer();
            return true;
        }
    } else {
        const comfyUrl = extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188';
        const status = await cnbCheckComfyStatus(comfyUrl);
        if (status.online) {
            cnbServiceState.status = 'online';
            cnbServiceState.lastCheck = new Date().toISOString();
            cnbServiceState.consecutiveFailures = 0;
            cnbUpdateStatusUI('online', '服务在线');
            cnbResetAutoStopTimer();
            return true;
        }
    }

    cnbServiceState.consecutiveFailures++;

    if (settings.cnbAutoWake) {
        console.log('[Story-Images CNB] Service offline, auto-waking...');
        cnbUpdateStatusUI('offline', '服务离线，正在自动启动...');
        return await cnbAutoSetup();
    }

    cnbServiceState.status = 'offline';
    cnbUpdateStatusUI('offline', '服务离线');
    showToast('⚠️ ComfyUI服务离线，请手动唤醒或启用自动唤醒', 'error');
    return false;
}

function cnbStartKeepAlive() {
    const settings = getSettings();
    cnbStopKeepAlive();

    if (!settings.cnbKeepAlive || !settings.cnbEnabled) return;

    const interval = (settings.cnbKeepAliveInterval || 300) * 1000;
    console.log(`[Story-Images CNB] Keep-alive started (interval: ${settings.cnbKeepAliveInterval || 300}秒)`);

    cnbServiceState.keepAliveTimer = setInterval(async () => {
        if (settings.cnbApiToken && settings.cnbRepoPath) {
            try {
                const wsStatus = await cnbCheckWorkspaceStatus();
                if (wsStatus.running) {
                    cnbServiceState.status = 'online';
                    cnbServiceState.lastCheck = new Date().toISOString();
                    cnbServiceState.consecutiveFailures = 0;
                    cnbUpdateStatusUI('online', '服务在线 (keep-alive)');
                    console.log('[Story-Images CNB] Keep-alive: workspace running');
                    return;
                }
            } catch (e) {
                console.warn('[Story-Images CNB] Keep-alive workspace check failed:', e.message);
            }
        }

        const comfyUrl = extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188';
        const status = await cnbCheckComfyStatus(comfyUrl);

        if (status.online) {
            cnbServiceState.status = 'online';
            cnbServiceState.lastCheck = new Date().toISOString();
            cnbServiceState.consecutiveFailures = 0;
            cnbUpdateStatusUI('online', '服务在线 (keep-alive)');
            console.log('[Story-Images CNB] Keep-alive ping: online');
        } else {
            cnbServiceState.consecutiveFailures++;
            console.warn(`[Story-Images CNB] Keep-alive ping: offline (failures: ${cnbServiceState.consecutiveFailures})`);

            if (cnbServiceState.consecutiveFailures >= 2 && settings.cnbAutoWake) {
                console.log('[Story-Images CNB] Service went offline, auto-waking via keep-alive...');
                cnbUpdateStatusUI('offline', '检测到离线，正在自动启动...');
                cnbAutoSetup();
            } else {
                cnbServiceState.status = 'offline';
                cnbUpdateStatusUI('offline', '服务离线');
            }
        }
    }, interval);
}

function cnbStopKeepAlive() {
    if (cnbServiceState.keepAliveTimer) {
        clearInterval(cnbServiceState.keepAliveTimer);
        cnbServiceState.keepAliveTimer = null;
        console.log('[Story-Images CNB] Keep-alive stopped');
    }
}

function cnbStartStatusPolling() {
    cnbStopStatusPolling();
    const settings = getSettings();
    if (!settings.cnbEnabled) return;

    cnbServiceState.pollTimer = setInterval(async () => {
        if (cnbServiceState.isWaking) return;
        const prevStatus = cnbServiceState.status;

        if (settings.cnbApiToken && settings.cnbRepoPath) {
            try {
                const wsStatus = await cnbCheckWorkspaceStatus();
                if (wsStatus.running) {
                    cnbServiceState.status = 'online';
                    cnbServiceState.lastCheck = new Date().toISOString();
                    cnbServiceState.consecutiveFailures = 0;
                    cnbUpdateStatusUI('online', '服务在线');
                } else {
                    cnbServiceState.consecutiveFailures++;
                    if (cnbServiceState.consecutiveFailures >= 2) {
                        cnbServiceState.status = 'offline';
                        cnbUpdateStatusUI('offline', '服务离线');
                    } else {
                        cnbUpdateStatusUI('checking', '检测中...');
                    }
                }
            } catch (e) {
                cnbServiceState.consecutiveFailures++;
                cnbUpdateStatusUI('offline', '检测失败');
            }
        } else {
            const comfyUrl = extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188';
            const status = await cnbCheckComfyStatus(comfyUrl);
            if (status.online) {
                cnbServiceState.status = 'online';
                cnbServiceState.lastCheck = new Date().toISOString();
                cnbServiceState.consecutiveFailures = 0;
                cnbUpdateStatusUI('online', '服务在线');
            } else {
                cnbServiceState.consecutiveFailures++;
                if (cnbServiceState.consecutiveFailures >= 2) {
                    cnbServiceState.status = 'offline';
                    cnbUpdateStatusUI('offline', '服务离线');
                } else {
                    cnbUpdateStatusUI('checking', '检测中...');
                }
            }
        }
    }, 30000);
}

function cnbStopStatusPolling() {
    if (cnbServiceState.pollTimer) {
        clearInterval(cnbServiceState.pollTimer);
        cnbServiceState.pollTimer = null;
    }
}

const cnbStartupStages = [
    { key: 'init', label: '初始化', progress: 5 },
    { key: 'request', label: '发送启动请求', progress: 15 },
    { key: 'prepare', label: '环境准备中', progress: 40 },
    { key: 'building', label: '构建工作空间', progress: 65 },
    { key: 'starting', label: '服务启动中', progress: 85 },
    { key: 'syncing', label: '同步配置', progress: 95 },
    { key: 'done', label: '启动完成', progress: 100 },
];

function cnbUpdateStatusUI(status, message, extra) {
    const settings = getSettings();
    const statusEl = document.getElementById('si_cnb_status');
    if (!statusEl) return;

    const statusConfig = {
        online: { icon: '🟢', color: '#00c864', label: '在线' },
        offline: { icon: '🔴', color: '#ff5050', label: '离线' },
        waking: { icon: '🟡', color: '#ffc800', label: '启动中' },
        checking: { icon: '🔵', color: '#4a9eff', label: '检测中' },
        unknown: { icon: '⚪', color: '#888', label: '未知' },
    };

    const cfg = statusConfig[status] || statusConfig.unknown;
    const lastCheck = cnbServiceState.lastCheck
        ? new Date(cnbServiceState.lastCheck).toLocaleTimeString()
        : '未检测';
    const lastWake = cnbServiceState.lastWake
        ? new Date(cnbServiceState.lastWake).toLocaleTimeString()
        : '无';
    const snInfo = cnbServiceState.workspaceSn
        ? ` | SN: ${cnbServiceState.workspaceSn.substring(0, 12)}...`
        : '';
    const autoStopInfo = settings.cnbAutoStop && cnbServiceState.lastActivity
        ? ` | 自动停止: ${settings.cnbAutoStopDelay || 30}分钟`
        : '';

    let progressHtml = '';
    if (extra?.progress !== undefined) {
        const pct = Math.min(100, Math.max(0, extra.progress));
        const stageLabel = extra.stageLabel || '';
        const barColor = status === 'online' ? '#00c864' : status === 'offline' ? '#ff5050' : '#4a9eff';
        const animClass = status === 'waking' ? 'si-progress-animated' : '';
        progressHtml = `
            <div style="margin: 6px 0 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                    <span style="font-size: 10px; color: #ccc;">${escapeHtml(stageLabel)}</span>
                    <span style="font-size: 10px; color: ${barColor}; font-weight: bold;">${pct}%</span>
                </div>
                <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                    <div class="${animClass}" style="width: ${pct}%; height: 100%; background: ${barColor}; border-radius: 3px; transition: width 0.5s ease;"></div>
                </div>
            </div>
        `;
    }

    let detailHtml = '';
    if (extra?.detail) {
        const d = extra.detail;
        const items = [];
        if (d.workspaceSn) items.push(`<span>SN: ${escapeHtml(d.workspaceSn.substring(0, 16))}...</span>`);
        if (d.branch) items.push(`<span>分支: ${escapeHtml(d.branch)}</span>`);
        if (d.duration) items.push(`<span>运行时长: ${cnbFormatDuration(d.duration)}</span>`);
        if (d.comfyUrl) items.push(`<span style="word-break: break-all;">URL: ${escapeHtml(d.comfyUrl)}</span>`);
        if (d.error) items.push(`<span style="color: #ff8080;">⚠ ${escapeHtml(d.error)}</span>`);
        if (d.buildStage) items.push(`<span>构建阶段: ${escapeHtml(d.buildStage)}</span>`);
        if (d.elapsed) items.push(`<span>已等待: ${d.elapsed}秒</span>`);
        if (items.length) {
            detailHtml = `<div style="margin-top: 6px; padding: 5px 6px; background: rgba(0,0,0,0.15); border-radius: 3px; font-size: 10px; color: #aaa; display: flex; flex-direction: column; gap: 2px;">${items.join('')}</div>`;
        }
    }

    statusEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="font-size: 16px;">${cfg.icon}</span>
            <span style="color: ${cfg.color}; font-weight: bold;">${cfg.label}</span>
            <span style="color: #888; font-size: 11px;">${escapeHtml(message || '')}</span>
        </div>
        ${progressHtml}
        ${detailHtml}
        <div style="font-size: 10px; color: #666; margin-top: 4px;">
            上次检测: ${lastCheck} | 上次启动: ${lastWake}${snInfo}${autoStopInfo}
        </div>
    `;

    const forwardedEl = document.getElementById('si_cnb_forwarded_address');
    if (forwardedEl) {
        if (cnbServiceState.pipelineId) {
            const fwdUrl = `https://${cnbServiceState.pipelineId}-8188.cnb.run/`;
            if (status === 'online') {
                forwardedEl.innerHTML = `<a href="${fwdUrl}" target="_blank" style="color: #4a9eff; text-decoration: none;">${fwdUrl}</a>`;
            } else {
                forwardedEl.textContent = fwdUrl;
            }
        } else {
            forwardedEl.textContent = '服务未启动';
        }
    }
}

function cnbFormatDuration(ms) {
    if (!ms) return '0秒';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}秒`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (min < 60) return `${min}分${remSec}秒`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hr}时${remMin}分`;
}

const REMOTE_API_PRESETS = [
    { key: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
    { key: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { key: 'qwen', label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
    { key: 'zhipu', label: '智谱GLM', url: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash', 'glm-4-plus', 'glm-4'] },
    { key: 'moonshot', label: 'Moonshot', url: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
    { key: 'custom', label: '自定义', url: '', models: [] },
];

function maskApiKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return key.substring(0, 4) + '••••' + key.substring(key.length - 4);
}

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }
    const settings = extension_settings[EXT_NAME];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (settings[key] === undefined) {
            settings[key] = typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
        }
    }
    return settings;
}

function showToast(message, type = 'info') {
    const settings = getSettings();
    if (!settings.showToasts) return;
    try {
        if (typeof toastr !== 'undefined') {
            toastr[type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'](message, '图片功能辅助');
        }
    } catch (e) {
        console.log(`[Story-Images] ${message}`);
    }
}

function getCharacterName() {
    try {
        const context = getContext();
        return context.name2 || '';
    } catch (e) {
        return '';
    }
}

function getCharKey() {
    try {
        if (this_chid !== undefined && !selected_group) {
            return getCharaFilename(this_chid);
        }
        return '';
    } catch (e) {
        return '';
    }
}

function getCharacterPrompt(charName) {
    const charKey = getCharKey();
    if (charKey && extension_settings.sd?.character_prompts?.[charKey]) {
        return extension_settings.sd.character_prompts[charKey];
    }
    if (charName && extension_settings.sd?.character_prompts?.[charName]) {
        return extension_settings.sd.character_prompts[charName];
    }
    const settings = getSettings();
    if (charKey && settings.characterPrompts[charKey]) {
        return settings.characterPrompts[charKey];
    }
    if (charName && settings.characterPrompts[charName]) {
        return settings.characterPrompts[charName];
    }
    return '';
}

function getCharacterNegative(charName) {
    const charKey = getCharKey();
    if (charKey && extension_settings.sd?.character_negative_prompts?.[charKey]) {
        return extension_settings.sd.character_negative_prompts[charKey];
    }
    if (charName && extension_settings.sd?.character_negative_prompts?.[charName]) {
        return extension_settings.sd.character_negative_prompts[charName];
    }
    const settings = getSettings();
    if (charKey && settings.characterNegatives[charKey]) {
        return settings.characterNegatives[charKey];
    }
    if (charName && settings.characterNegatives[charName]) {
        return settings.characterNegatives[charName];
    }
    return '';
}

function detectCurrentModel() {
    const sd = extension_settings.sd;
    if (!sd || !sd.model) return null;
    const modelName = sd.model.toLowerCase();
    for (const [key, profile] of Object.entries(MODEL_PROFILES)) {
        if (profile.pattern.test(modelName)) return key;
    }
    return null;
}

function getOptimalStyleConfig(styleKey) {
    const styleConfig = STYLE_CONFIGS[styleKey] || STYLE_CONFIGS.anime;
    const currentModel = detectCurrentModel();
    if (currentModel && styleConfig.modelConfigs[currentModel]) {
        return { ...styleConfig, activeModel: currentModel, activeConfig: styleConfig.modelConfigs[currentModel] };
    }
    const useModel = styleConfig.recommendedModel || Object.keys(styleConfig.modelConfigs)[0];
    return { ...styleConfig, activeModel: useModel, activeConfig: styleConfig.modelConfigs[useModel] };
}

function getStyleConfig() {
    const settings = getSettings();
    const styleKey = settings.style || 'anime';
    const optimized = getOptimalStyleConfig(styleKey);
    if (optimized.activeConfig) {
        return {
            label: optimized.label, icon: optimized.icon, description: optimized.description,
            recommendedModel: optimized.recommendedModel,
            promptPrefix: optimized.activeConfig.promptPrefix, negativeExtra: optimized.activeConfig.negativeExtra,
            scale: optimized.activeConfig.scale, steps: optimized.activeConfig.steps,
            sampler: optimized.activeConfig.sampler, size: optimized.activeConfig.size,
            workflow: optimized.activeConfig.workflow, tip: optimized.activeConfig.tip,
            activeModel: optimized.activeModel,
        };
    }
    return STYLE_CONFIGS.anime.modelConfigs.animagine_xl_v31;
}

function getRecommendedModelForStyle(styleKey) {
    const styleConfig = STYLE_CONFIGS[styleKey];
    if (!styleConfig) return null;
    return MODEL_PROFILES[styleConfig.recommendedModel] || null;
}

function getModelMatchInfo(styleKey) {
    const currentModel = detectCurrentModel();
    const styleConfig = STYLE_CONFIGS[styleKey] || STYLE_CONFIGS.anime;
    const recommended = styleConfig.recommendedModel;
    const isOptimal = currentModel === recommended;
    const currentModelProfile = currentModel ? MODEL_PROFILES[currentModel] : null;
    const recommendedProfile = MODEL_PROFILES[recommended];
    return {
        currentModel, currentModelName: currentModelProfile?.name || '未知模型',
        recommendedModel: recommended, recommendedModelName: recommendedProfile?.name || '未知',
        isOptimal, hasModelConfig: currentModel ? !!styleConfig.modelConfigs[currentModel] : false,
        tip: currentModel && styleConfig.modelConfigs[currentModel] ? styleConfig.modelConfigs[currentModel].tip : '当前模型无此风格的优化配置，建议切换推荐模型',
    };
}


function applyStyleToSdConfig(styleKey) {
    const styleConfig = getStyleConfig();
    if (!styleConfig || !styleConfig.promptPrefix) return;
    console.log(`[Story-Images] Style config ready: ${styleConfig.label} | CFG=${styleConfig.scale} Steps=${styleConfig.steps} Sampler=${styleConfig.sampler} Size=${styleConfig.size || 'default'} (applied temporarily during generation only)`);
}

async function autoSwitchModel(styleKey) {
    const sd = extension_settings.sd;
    if (!sd || sd.source !== 'comfy') return false;
    const styleConfig = STYLE_CONFIGS[styleKey];
    if (!styleConfig) return false;
    const recommendedModelId = styleConfig.recommendedModel;
    const recommendedProfile = MODEL_PROFILES[recommendedModelId];
    if (!recommendedProfile) return false;
    const currentModel = detectCurrentModel();
    if (currentModel === recommendedModelId) return true;
    const comfyUrl = (sd.comfy_url || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    try {
        const response = await fetch(`${comfyUrl}/object_info/CheckpointLoaderSimple`);
        if (!response.ok) return false;
        const data = await response.json();
        const availableModels = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        const targetModel = availableModels.find(m => recommendedProfile.pattern.test(m.toLowerCase()));
        if (targetModel) {
            sd.model = targetModel;
            console.log(`[Story-Images] Auto-switched model to: ${targetModel}`);
            showToast(`🔄 已自动切换模型: ${targetModel}`, 'success');
            return true;
        } else {
            const currentModelFile = sd.model;
            const isCurrentModelAvailable = !currentModelFile || availableModels.includes(currentModelFile);
            if (!isCurrentModelAvailable && availableModels.length > 0) {
                const bestFallback = findBestFallbackModel(availableModels, styleKey);
                sd.model = bestFallback;
                console.log(`[Story-Images] Recommended model unavailable, current model invalid. Fallback to: ${bestFallback}`);
                showToast(`⚠️ 推荐模型 ${recommendedProfile.name} 未安装，当前模型也不可用，已切换至: ${bestFallback}`, 'info');
            } else if (isCurrentModelAvailable) {
                console.log(`[Story-Images] Recommended model unavailable, keeping current valid model: ${currentModelFile}`);
                showToast(`⚠️ 推荐模型 ${recommendedProfile.name} 未安装，使用当前模型: ${currentModelFile}`, 'info');
            } else {
                console.log(`[Story-Images] No available models found in ComfyUI`);
                showToast(`⚠️ ComfyUI中未找到可用模型`, 'error');
            }
            return false;
        }
    } catch (e) {
        console.warn('[Story-Images] Failed to auto-switch model:', e.message);
        return false;
    }
}

function findBestFallbackModel(availableModels, styleKey) {
    const styleConfig = STYLE_CONFIGS[styleKey];
    if (styleConfig) {
        for (const [modelId, config] of Object.entries(styleConfig.modelConfigs)) {
            const profile = MODEL_PROFILES[modelId];
            if (profile) {
                const match = availableModels.find(m => profile.pattern.test(m.toLowerCase()));
                if (match) return match;
            }
        }
    }
    for (const [modelId, profile] of Object.entries(MODEL_PROFILES)) {
        const match = availableModels.find(m => profile.pattern.test(m.toLowerCase()));
        if (match) return match;
    }
    return availableModels[0] || '';
}

function sanitizeExpandedPrompt(raw) {
    let result = raw;
    result = result.replace(/```[\s\S]*?```/g, '');
    result = result.replace(/```/g, '');
    result = result.replace(/["'`]/g, '');
    result = result.replace(/\n/g, ', ');
    result = result.replace(/^[Tt]he\s+(expanded\s+)?prompt\s*(is|should be|tags)[:\s]*/i, '');
    result = result.replace(/^Output[:\s]*/i, '');
    result = result.replace(/^Here\s+(are|is)\s*/i, '');
    result = result.replace(/^Tags?[:\s]*/i, '');
    result = result.replace(/\b(?:here|are|the|following|tags|prompt|description|scene)\s*[:：]/gi, '');
    result = result.replace(/[\u4e00-\u9fff]/g, '');
    result = result.replace(/[(){}[\]]/g, '');
    result = result.replace(/\s+/g, ' ');
    result = result.replace(/,\s*,/g, ',');
    result = result.replace(/^,\s*/, '');
    result = result.replace(/\s*,\s*$/, '');
    const tags = result.split(',').map(t => t.trim().replace(/\s+/g, '_')).filter(t => t.length > 0);
    const seen = new Set();
    const deduped = [];
    for (const tag of tags) {
        const lower = tag.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            deduped.push(tag);
        }
    }
    return deduped.join(', ');
}

function buildDirectChinesePrompt(description, charPrompt) {
    let prompt = description;
    if (charPrompt) {
        prompt = charPrompt + ', ' + prompt;
    }
    return prompt;
}

async function fetchOllamaModels() {
    const settings = getSettings();
    const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
    try {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const models = (data.models || []).map(m => m.name);
        cachedOllamaModels = models;
        return models;
    } catch (e) {
        console.warn('[Story-Images] Failed to fetch Ollama models:', e.message);
        cachedOllamaModels = [];
        return [];
    }
}

async function fetchComfyWorkflows() {
    try {
        const response = await fetch('/api/sd/comfy/workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188' }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const workflows = await response.json();
        cachedComfyWorkflows = workflows;
        return workflows;
    } catch (e) {
        console.warn('[Story-Images] Failed to fetch ComfyUI workflows:', e.message);
        cachedComfyWorkflows = [];
        return [];
    }
}

async function expandPromptWithOllama(description, charPrompt) {
    const settings = getSettings();
    const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
    let model = settings.ollamaModel || '';

    if (!model) {
        try {
            const models = await fetchOllamaModels();
            const preferred = models.find(m =>
                m.includes('qwen') || m.includes('llama') || m.includes('gemma')
            );
            if (preferred) {
                model = preferred;
            } else if (models.length > 0) {
                model = models[0];
            }
            if (model) {
                settings.ollamaModel = model;
                saveSettingsDebounced();
            }
        } catch (e) {
            console.warn('[Story-Images] Failed to auto-detect Ollama model:', e);
        }
    }

    if (!model) {
        throw new Error('No Ollama model available.');
    }

    const userPrompt = EXPANSION_USER_TEMPLATE
        .replace('{description}', description)
        .replace('{charPrompt}', charPrompt || 'no specific character tags');

    const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: getExpansionSystemPrompt() },
                { role: 'user', content: userPrompt },
            ],
            stream: false,
            options: {
                temperature: 0.5,
                top_p: 0.85,
                num_predict: 400,
                repeat_penalty: 1.15,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    let result = data.message?.content || '';
    result = sanitizeExpandedPrompt(result);
    return result;
}

async function expandPromptWithSTLLM(description, charPrompt) {
    const prompt = `${getExpansionSystemPrompt()}\n\n${EXPANSION_USER_TEMPLATE}`
        .replace('{description}', description)
        .replace('{charPrompt}', charPrompt || 'no specific character tags');

    const reply = await generateQuietPrompt({ quietPrompt: prompt, responseLength: 400 });
    if (!reply) {
        throw new Error('LLM generated empty response');
    }
    return sanitizeExpandedPrompt(reply);
}

async function fetchRemoteApiModels() {
    const settings = getSettings();
    const apiUrl = settings.remoteApiUrl || '';
    const apiKey = settings.remoteApiKey || '';

    if (!apiUrl) {
        cachedRemoteApiModels = [];
        return [];
    }

    try {
        const baseUrl = apiUrl.replace(/\/+$/, '');
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: headers,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const models = (data.data || []).map(m => m.id || m.name || m.model).filter(Boolean);
        cachedRemoteApiModels = models;
        console.log(`[Story-Images] Remote API models fetched: ${models.length}`);
        return models;
    } catch (e) {
        if (e.name === 'AbortError') {
            console.warn('[Story-Images] Remote API models fetch timed out');
        } else {
            console.warn('[Story-Images] Failed to fetch remote API models:', e.message);
        }
        cachedRemoteApiModels = [];
        return [];
    }
}

async function expandPromptWithRemoteApi(description, charPrompt) {
    const settings = getSettings();
    const apiUrl = settings.remoteApiUrl || '';
    const apiKey = settings.remoteApiKey || '';
    const model = settings.remoteApiModel || '';
    const timeout = (settings.remoteApiTimeout || 30) * 1000;

    if (!apiUrl) {
        throw new Error('远程API地址未配置');
    }
    if (!apiKey) {
        throw new Error('远程API密钥未配置');
    }
    if (!model) {
        throw new Error('远程API模型未选择');
    }

    const baseUrl = apiUrl.replace(/\/+$/, '');
    const userPrompt = EXPANSION_USER_TEMPLATE
        .replace('{description}', description)
        .replace('{charPrompt}', charPrompt || 'no specific character tags');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
        response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: getExpansionSystemPrompt() },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.5,
                top_p: 0.85,
                max_tokens: 400,
                stream: false,
            }),
            signal: controller.signal,
        });
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            throw new Error(`请求超时(${settings.remoteApiTimeout || 30}秒)，请检查网络或增加超时时间`);
        }
        throw new Error(`网络错误: ${e.message}`);
    }

    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
        throw new Error('认证失败: API密钥无效或已过期');
    }

    if (response.status === 429) {
        throw new Error('请求频率超限: 请稍后重试或检查API配额');
    }

    if (response.status === 404) {
        throw new Error(`模型不存在: "${model}"可能不可用，请检查模型名称`);
    }

    if (!response.ok) {
        let errorDetail = '';
        try {
            const errData = await response.json();
            errorDetail = errData.error?.message || errData.message || JSON.stringify(errData);
        } catch (_) {
            errorDetail = await response.text().catch(() => '');
        }
        throw new Error(`API错误(${response.status}): ${errorDetail || '未知错误'}`);
    }

    const data = await response.json();
    let result = data.choices?.[0]?.message?.content || '';

    if (!result) {
        throw new Error('远程API返回空响应');
    }

    result = sanitizeExpandedPrompt(result);
    return result;
}

async function testRemoteApiConnection() {
    const settings = getSettings();
    const apiUrl = settings.remoteApiUrl || '';
    const apiKey = settings.remoteApiKey || '';

    if (!apiUrl) {
        showToast('请先配置远程API地址', 'error');
        return false;
    }

    const baseUrl = apiUrl.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: headers,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
            showToast('远程API认证失败: API密钥无效', 'error');
            return false;
        }

        if (!response.ok) {
            showToast(`远程API连接失败: HTTP ${response.status}`, 'error');
            return false;
        }

        const data = await response.json();
        const models = (data.data || []).map(m => m.id || m.name || m.model).filter(Boolean);
        cachedRemoteApiModels = models;

        const maskedKey = maskApiKey(apiKey);
        showToast(`远程API连接成功! 密钥: ${maskedKey} | 可用模型: ${models.length}个`, 'success');
        return true;
    } catch (e) {
        if (e.name === 'AbortError') {
            showToast('远程API连接超时(15秒)，请检查地址和网络', 'error');
        } else {
            showToast(`远程API连接失败: ${e.message}`, 'error');
        }
        return false;
    }
}

async function fetchCharacterList() {
    try {
        const response = await fetch('/api/characters/all', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ shallow: true }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data || [];
    } catch (e) {
        console.warn('[Story-Images] Failed to fetch character list:', e.message);
        return [];
    }
}

async function fetchCharacterData(avatarUrl) {
    try {
        const response = await fetch('/api/characters/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn(`[Story-Images] Failed to fetch character ${avatarUrl}:`, e.message);
        return null;
    }
}

async function fetchWorldInfoList() {
    try {
        const response = await fetch('/api/worldinfo/list', {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data || [];
    } catch (e) {
        console.warn('[Story-Images] Failed to fetch world info list:', e.message);
        return [];
    }
}

async function fetchWorldInfoData(name) {
    try {
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn(`[Story-Images] Failed to fetch world info ${name}:`, e.message);
        return null;
    }
}

async function fetchAllSettings() {
    try {
        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn('[Story-Images] Failed to fetch settings:', e.message);
        return null;
    }
}

async function fetchChatList(avatarUrl) {
    try {
        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data || [];
    } catch (e) {
        return [];
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadJson(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    downloadBlob(blob, filename);
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_');
}

function charDataToV2(charData) {
    const v2 = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {},
    };

    if (charData.spec === 'chara_card_v2' && charData.data) {
        v2.data = { ...charData.data };
    } else if (charData.data && typeof charData.data === 'object') {
        v2.data = { ...charData.data };
        if (charData.name) v2.data.name = charData.name;
    } else {
        v2.data = { ...charData };
    }

    const v1Fields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'];
    for (const field of v1Fields) {
        if (charData[field] !== undefined && v2.data[field] === undefined) {
            v2.data[field] = charData[field];
        }
    }

    if (charData.creator_notes !== undefined && v2.data.creator_notes === undefined) {
        v2.data.creator_notes = charData.creator_notes;
    }
    if (charData.system_prompt !== undefined && v2.data.system_prompt === undefined) {
        v2.data.system_prompt = charData.system_prompt;
    }
    if (charData.post_history_instructions !== undefined && v2.data.post_history_instructions === undefined) {
        v2.data.post_history_instructions = charData.post_history_instructions;
    }
    if (charData.tags !== undefined && v2.data.tags === undefined) {
        v2.data.tags = charData.tags;
    }
    if (charData.creator !== undefined && v2.data.creator === undefined) {
        v2.data.creator = charData.creator;
    }
    if (charData.character_version !== undefined && v2.data.character_version === undefined) {
        v2.data.character_version = charData.character_version;
    }
    if (charData.alternate_greetings !== undefined && v2.data.alternate_greetings === undefined) {
        v2.data.alternate_greetings = charData.alternate_greetings;
    }

    if (!v2.data.extensions) v2.data.extensions = {};
    if (charData.talkativeness !== undefined && v2.data.extensions.talkativeness === undefined) {
        v2.data.extensions.talkativeness = charData.talkativeness;
    }
    if (charData.world !== undefined && v2.data.extensions.world === undefined) {
        v2.data.extensions.world = charData.world;
    }
    if (charData.depth_prompt_prompt !== undefined && !v2.data.extensions.depth_prompt) {
        v2.data.extensions.depth_prompt = {
            prompt: charData.depth_prompt_prompt || '',
            depth: charData.depth_prompt_depth ?? 4,
            role: charData.depth_prompt_role ?? 'system',
        };
    }

    if (charData.character_book) {
        v2.data.character_book = charData.character_book;
    }

    delete v2.data.extensions?.fav;
    delete v2.data.extensions?.chat;
    v2.data.extensions.fav = false;

    return v2;
}

async function exportCharacterAsV2Json(charName) {
    const avatarUrl = charName.endsWith('.png') ? charName : `${charName}.png`;
    try {
        const response = await fetch('/api/characters/export', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl, format: 'json' }),
        });
        if (response.ok) {
            return await response.json();
        }
    } catch (e) {
        console.warn(`[Story-Images] Native export failed for ${charName}, falling back to API data`);
    }

    const charData = await fetchCharacterData(avatarUrl);
    if (!charData) return null;
    return charDataToV2(charData);
}

async function exportCharactersAndWorldBooks(selectedChars, selectedWorlds, progressCallback) {
    console.log('[Story-Images] exportCharactersAndWorldBooks called');
    const Zip = await ensureJSZip();
    console.log('[Story-Images] JSZip loaded successfully');
    const zip = new Zip();
    const totalItems = selectedChars.length + selectedWorlds.length;
    let completed = 0;
    let charCount = 0;
    let worldCount = 0;

    for (const charName of selectedChars) {
        try {
            if (progressCallback) progressCallback(completed, totalItems, `正在导出角色: ${charName}`);
            const v2Data = await exportCharacterAsV2Json(charName);
            if (v2Data) {
                const name = (v2Data.data?.name || v2Data.name || charName).replace(/\.png$/, '');
                const filename = sanitizeFilename(name) + '.json';
                zip.file(`characters/${filename}`, JSON.stringify(v2Data, null, 4));
                charCount++;
            }
        } catch (e) {
            console.warn(`[Story-Images] Export character failed: ${charName}`, e);
        }
        completed++;
    }

    for (const worldName of selectedWorlds) {
        try {
            if (progressCallback) progressCallback(completed, totalItems, `正在导出世界书: ${worldName}`);
            const worldData = await fetchWorldInfoData(worldName);
            if (worldData) {
                const exportData = { ...worldData };
                if (!exportData.entries) {
                    exportData.entries = {};
                }
                const filename = sanitizeFilename(worldName) + '.json';
                zip.file(`worlds/${filename}`, JSON.stringify(exportData, null, 4));
                worldCount++;
            }
        } catch (e) {
            console.warn(`[Story-Images] Export world book failed: ${worldName}`, e);
        }
        completed++;
    }

    if (progressCallback) progressCallback(totalItems, totalItems, '正在生成ZIP文件...');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    if (progressCallback) progressCallback(totalItems, totalItems, '导出完成');
    return { blob, charCount, worldCount };
}

async function fetchChatData(avatarUrl, chatFileName) {
    try {
        const response = await fetch('/api/chats/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl, file_name: chatFileName }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        console.warn(`[Story-Images] Failed to fetch chat data: ${avatarUrl}/${chatFileName}`, e.message);
        return null;
    }
}

async function exportFullSettings(progressCallback) {
    console.log('[Story-Images] exportFullSettings called');
    const Zip = await ensureJSZip();
    console.log('[Story-Images] JSZip loaded successfully');
    const zip = new Zip();
    let charCount = 0;
    let worldCount = 0;
    let chatCount = 0;

    if (progressCallback) progressCallback(0, 6, '正在获取系统设置...');
    const settingsData = await fetchAllSettings();
    if (settingsData) {
        try {
            const settingsObj = typeof settingsData.settings === 'string'
                ? JSON.parse(settingsData.settings)
                : settingsData.settings;
            zip.file('settings.json', JSON.stringify(settingsObj, null, 4));
        } catch (_) {
            zip.file('settings.json', JSON.stringify(settingsData.settings, null, 4));
        }
    }

    if (progressCallback) progressCallback(1, 6, '正在获取角色列表...');
    const charList = await fetchCharacterList();
    const charNames = charList.map(c => c.avatar_url || c.name).filter(Boolean);

    if (progressCallback) progressCallback(2, 6, `正在导出 ${charNames.length} 个角色...`);
    for (let i = 0; i < charNames.length; i++) {
        const charName = charNames[i];
        try {
            const v2Data = await exportCharacterAsV2Json(charName);
            if (v2Data) {
                const name = (v2Data.data?.name || v2Data.name || charName).replace(/\.png$/, '');
                const filename = sanitizeFilename(name) + '.json';
                zip.file(`characters/${filename}`, JSON.stringify(v2Data, null, 4));
                charCount++;
            }

            const chatList = await fetchChatList(charName);
            const cleanName = charName.replace(/\.png$/, '');
            for (const chatItem of chatList) {
                try {
                    const chatFileName = chatItem.file_name || chatItem.file_id || chatItem;
                    const chatId = typeof chatFileName === 'string'
                        ? chatFileName.replace(/\.jsonl$/, '')
                        : chatFileName;
                    const chatData = await fetchChatData(charName, chatId);
                    if (chatData) {
                        const chatFile = typeof chatFileName === 'string' ? chatFileName : `${chatId}.jsonl`;
                        zip.file(`chats/${sanitizeFilename(cleanName)}/${sanitizeFilename(chatFile)}`, JSON.stringify(chatData, null, 4));
                        chatCount++;
                    }
                } catch (e) {
                    console.warn(`[Story-Images] Export chat failed: ${charName}/${chatItem}`, e);
                }
            }
        } catch (e) {
            console.warn(`[Story-Images] Export character failed: ${charName}`, e);
        }
    }

    if (progressCallback) progressCallback(3, 6, '正在导出世界书...');
    const worldList = await fetchWorldInfoList();
    const worldNames = worldList.map(w => w.name).filter(Boolean);
    for (const worldName of worldNames) {
        try {
            const worldData = await fetchWorldInfoData(worldName);
            if (worldData) {
                const exportData = { ...worldData };
                if (!exportData.entries) exportData.entries = {};
                const filename = sanitizeFilename(worldName) + '.json';
                zip.file(`worlds/${filename}`, JSON.stringify(exportData, null, 4));
                worldCount++;
            }
        } catch (e) {
            console.warn(`[Story-Images] Export world book failed: ${worldName}`, e);
        }
    }

    if (progressCallback) progressCallback(4, 6, '正在生成备份文件...');
    const manifest = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        type: 'sillytavern_full_backup',
        format: 'st_native_compatible',
        summary: {
            characters: charCount,
            worldBooks: worldCount,
            chatFiles: chatCount,
            hasSettings: !!settingsData,
        },
        instructions: {
            characters: '解压后，将characters/目录中的JSON文件逐个通过SillyTavern的"导入角色"功能导入',
            worlds: '解压后，将worlds/目录中的JSON文件逐个通过SillyTavern的"导入世界书"功能导入',
            settings: '将settings.json文件复制到SillyTavern的data/default-user/目录下覆盖（请先备份原文件）',
            chats: '将chats/目录复制到SillyTavern的data/default-user/chats/目录下',
        },
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 4));

    if (progressCallback) progressCallback(5, 6, '正在压缩...');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    if (progressCallback) progressCallback(6, 6, '完整备份导出完成');
    return { blob, charCount, worldCount, chatCount, hasSettings: !!settingsData };
}

async function importCharacterFromFile(file) {
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('file_type', 'json');
    formData.append('user_name', 'user');

    const response = await fetch('/api/characters/import', {
        method: 'POST',
        body: formData,
        headers: getRequestHeaders({ omitContentType: true }),
        cache: 'no-cache',
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

async function importWorldFromFile(file, worldName) {
    const formData = new FormData();
    formData.append('avatar', file);

    const jsonData = JSON.parse(await file.text());
    if (!jsonData.entries) {
        throw new Error('Invalid world info file: missing entries');
    }

    const blob = new Blob([JSON.stringify(jsonData)], { type: 'application/json' });
    const namedFile = new File([blob], `${worldName}.json`, { type: 'application/json' });
    formData.set('avatar', namedFile);

    const response = await fetch('/api/worldinfo/import', {
        method: 'POST',
        body: formData,
        headers: getRequestHeaders({ omitContentType: true }),
        cache: 'no-cache',
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

async function importFromZip(file, progressCallback) {
    const Zip = await ensureJSZip();
    const zip = await Zip.loadAsync(file);

    const charFiles = [];
    const worldFiles = [];
    let hasSettings = false;

    zip.forEach((relativePath, zipEntry) => {
        if (zipEntry.dir) return;
        const lowerPath = relativePath.toLowerCase();
        if (lowerPath.startsWith('characters/') && lowerPath.endsWith('.json')) {
            charFiles.push({ path: relativePath, name: relativePath.split('/').pop().replace('.json', '') });
        } else if (lowerPath.startsWith('worlds/') && lowerPath.endsWith('.json')) {
            worldFiles.push({ path: relativePath, name: relativePath.split('/').pop().replace('.json', '') });
        } else if (lowerPath === 'settings.json') {
            hasSettings = true;
        }
    });

    const totalItems = charFiles.length + worldFiles.length + (hasSettings ? 1 : 0);
    let completed = 0;
    let importedChars = 0;
    let importedWorlds = 0;
    const errors = [];

    for (const charFile of charFiles) {
        try {
            if (progressCallback) progressCallback(completed, totalItems, `正在导入角色: ${charFile.name}`);
            const content = await zip.file(charFile.path).async('string');
            const blob = new Blob([content], { type: 'application/json' });
            const file = new File([blob], `${charFile.name}.json`, { type: 'application/json' });
            const result = await importCharacterFromFile(file);
            if (result.file_name !== undefined) {
                importedChars++;
            } else if (result.error) {
                errors.push(`角色 ${charFile.name}: ${result.error}`);
            }
        } catch (e) {
            errors.push(`角色 ${charFile.name}: ${e.message}`);
        }
        completed++;
    }

    for (const worldFile of worldFiles) {
        try {
            if (progressCallback) progressCallback(completed, totalItems, `正在导入世界书: ${worldFile.name}`);
            const content = await zip.file(worldFile.path).async('string');
            const blob = new Blob([content], { type: 'application/json' });
            const file = new File([blob], `${worldFile.name}.json`, { type: 'application/json' });
            const result = await importWorldFromFile(file, worldFile.name);
            if (result.name) {
                importedWorlds++;
            }
        } catch (e) {
            errors.push(`世界书 ${worldFile.name}: ${e.message}`);
        }
        completed++;
    }

    if (progressCallback) progressCallback(totalItems, totalItems, '导入完成');
    return { importedChars, importedWorlds, hasSettings, errors, totalChars: charFiles.length, totalWorlds: worldFiles.length };
}

async function expandPrompt(description, charName) {
    const settings = getSettings();
    const charPrompt = getCharacterPrompt(charName);
    const method = settings.expansionMethod || 'direct';

    console.log(`[Story-Images] Method: ${method} | Style: ${settings.style} | Expanding: "${description}" | char: "${charName}"`);

    if (method === 'direct') {
        const result = buildDirectChinesePrompt(description, charPrompt);
        console.log(`[Story-Images] Direct mode: "${result.substring(0, 100)}..."`);
        return result;
    }

    let expandedPrompt = '';
    let currentMethod = method;

    if (currentMethod === 'remote_api') {
        try {
            expandedPrompt = await expandPromptWithRemoteApi(description, charPrompt);
            console.log(`[Story-Images] Remote API OK: "${expandedPrompt.substring(0, 100)}..."`);
        } catch (e) {
            console.warn('[Story-Images] Remote API failed:', e.message);
            showToast(`远程API扩展失败: ${e.message}`, 'error');
            currentMethod = 'st_llm_fallback';
        }
    }

    if (currentMethod === 'ollama') {
        try {
            expandedPrompt = await expandPromptWithOllama(description, charPrompt);
            console.log(`[Story-Images] Ollama OK: "${expandedPrompt.substring(0, 100)}..."`);
        } catch (e) {
            console.warn('[Story-Images] Ollama failed:', e.message);
            showToast('Ollama扩展失败，尝试ST LLM...', 'info');
            currentMethod = 'st_llm_fallback';
        }
    }

    if (currentMethod === 'st_llm' || currentMethod === 'st_llm_fallback') {
        try {
            expandedPrompt = await expandPromptWithSTLLM(description, charPrompt);
            console.log(`[Story-Images] ST LLM OK: "${expandedPrompt.substring(0, 100)}..."`);
        } catch (e) {
            console.warn('[Story-Images] ST LLM failed:', e.message);
            expandedPrompt = '';
        }
    }

    if (!expandedPrompt) {
        console.warn('[Story-Images] All expansion failed, using basic');
        expandedPrompt = buildBasicPrompt(description, charPrompt);
    }

    return expandedPrompt;
}

function buildBasicPrompt(description, charPrompt) {
    let prompt = '';
    if (charPrompt) {
        prompt += charPrompt + ', ';
    }
    prompt += description.replace(/[\u4e00-\u9fff]/g, '').trim();
    if (!/1girl|1boy|multiple/i.test(prompt) && charPrompt) {
        prompt = '1girl, ' + prompt;
    }
    return prompt;
}

function assessPromptQuality(expandedPrompt, originalDescription, isDirectMode) {
    const settings = getSettings();
    if (!settings.qualityAssessment) {
        return { score: 100, missing: [], passed: true };
    }

    const elements = isDirectMode ? CHINESE_QUALITY_ELEMENTS : QUALITY_ELEMENTS;
    const lower = expandedPrompt.toLowerCase();
    const results = {};
    let score = 0;
    const missing = [];
    const maxScore = elements.length * 14;

    for (const element of elements) {
        const found = element.patterns.some(p => p.test(lower));
        results[element.key] = found;
        if (found) {
            score += 14;
        } else {
            missing.push(element.label);
        }
    }

    if (!isDirectMode) {
        const hasChinese = /[\u4e00-\u9fff]/.test(expandedPrompt);
        if (hasChinese) {
            score -= 30;
            missing.push('含中文');
        }
    }

    const tooShort = expandedPrompt.split(/[，,]/).length < 5;
    if (tooShort) {
        score -= 15;
        missing.push('描述过短');
    }

    if (!isDirectMode) {
        const hasSubject = /1girl|1boy|1other|multiple|solo|couple/i.test(expandedPrompt);
        if (!hasSubject) {
            score -= 20;
            missing.push('缺少主体标签');
        }
    }

    score = Math.max(0, Math.min(100, Math.round(score / maxScore * 100)));
    const passed = score >= 40;

    return { score, missing, passed, results };
}

function logGeneration(data) {
    const settings = getSettings();
    if (!Array.isArray(settings.generationLog)) {
        settings.generationLog = [];
    }
    settings.generationLog.push({
        timestamp: new Date().toISOString(),
        ...data,
    });
    if (settings.generationLog.length > 100) {
        settings.generationLog = settings.generationLog.slice(-100);
    }
    saveSettingsDebounced();
}

function buildFinalPrompt(expandedPrompt, charPrompt, charNegative, isDirectMode) {
    if (isDirectMode) {
        return expandedPrompt;
    }

    let finalPrompt = expandedPrompt;

    if (charPrompt) {
        const charFirstTag = charPrompt.split(',')[0].trim().toLowerCase();
        const expandedLower = expandedPrompt.toLowerCase();
        if (!expandedLower.includes(charFirstTag)) {
            finalPrompt = charPrompt + ', ' + finalPrompt;
        }
    }

    if (!/1girl|1boy|1other|multiple|solo|couple/i.test(finalPrompt)) {
        finalPrompt = '1girl, ' + finalPrompt;
    }

    if (!/close-up|upper_body|full_body|from_above|from_below|pov|wide_shot|portrait|cowboy_shot/i.test(finalPrompt)) {
        finalPrompt += ', upper_body';
    }

    return finalPrompt;
}

const MODEL_COMPAT_RULES = [
    {
        pattern: /qwen.?image/i,
        name: 'Qwen Image',
        issues: ['此模型不是Stable Diffusion架构，无法使用标准ComfyUI工作流', '需要专用工作流（含QwenImageEdit节点和VAE编码器）', '标准CheckpointLoaderSimple节点不兼容此模型'],
        severity: 'critical',
        suggestion: '请切换回SD/SDXL模型（如animagineXLV31），或安装Qwen Image专用工作流',
    },
    {
        pattern: /flux/i,
        name: 'Flux',
        issues: ['Flux模型需要专用工作流，标准SD工作流不兼容', 'Flux使用不同的CLIP和VAE配置'],
        severity: 'critical',
        suggestion: '请安装Flux专用ComfyUI工作流，或切换回SD/SDXL模型',
    },
    {
        pattern: /sd3|stable.?diffusion.?3/i,
        name: 'Stable Diffusion 3',
        issues: ['SD3使用MM-DiT架构，部分标准工作流可能不兼容', '需要使用TripleCLIPLoader而非标准CLIP'],
        severity: 'warning',
        suggestion: '确保使用SD3兼容的工作流，或切换回SD 1.5/SDXL模型',
    },
    {
        pattern: /lcm/i,
        name: 'LCM模型',
        issues: ['LCM模型需要极低CFG(1-2)和较少步数(4-8)', '标准参数(CFG=5-7, Steps=25-30)会导致过曝'],
        severity: 'warning',
        suggestion: '如使用LCM模型，建议切换风格参数或手动调整CFG/Steps',
    },
];

function checkModelCompatibility() {
    const sd = extension_settings.sd;
    if (!sd) return { compatible: true, warnings: [], errors: [] };

    const model = sd.model || '';
    const warnings = [];
    const errors = [];

    for (const rule of MODEL_COMPAT_RULES) {
        if (rule.pattern.test(model)) {
            const issue = {
                name: rule.name,
                model: model,
                issues: rule.issues,
                suggestion: rule.suggestion,
            };
            if (rule.severity === 'critical') {
                errors.push(issue);
            } else {
                warnings.push(issue);
            }
        }
    }

    return { compatible: errors.length === 0, warnings, errors };
}

async function validateBeforeGeneration() {
    const settings = getSettings();
    if (!settings.modelCheckEnabled) return true;

    const compat = checkModelCompatibility();

    if (compat.errors.length > 0) {
        const err = compat.errors[0];
        const msg = `⚠️ 模型不兼容: ${err.name}\n模型: ${err.model}\n问题: ${err.issues[0]}\n建议: ${err.suggestion}`;
        console.error(`[Story-Images] Model compatibility error:`, err);
        showToast(msg, 'error');
        return false;
    }

    if (compat.warnings.length > 0) {
        const warn = compat.warnings[0];
        const msg = `⚠️ 模型兼容性警告: ${warn.name} — ${warn.issues[0]}`;
        console.warn(`[Story-Images] Model compatibility warning:`, warn);
        showToast(msg, 'info');
    }

    return true;
}

async function waitForGeneratePicture(maxRetries = 10, intervalMs = 500) {
    for (let i = 0; i < maxRetries; i++) {
        if (typeof globalThis.generatePicture === 'function') return globalThis.generatePicture;
        if (typeof generatePicture === 'function') return generatePicture;
        if (i < maxRetries - 1) {
            if (i === 0) console.log('[Story-Images] Waiting for generatePicture to become available...');
            await new Promise(r => setTimeout(r, intervalMs));
        }
    }
    return null;
}

async function generateImageForTag(description, charName, tagType) {
    const sd = extension_settings.sd;
    if (!sd) {
        showToast('图片生成扩展未加载，请在扩展管理中确认Image Generation已启用', 'error');
        return null;
    }
    if (!sd.source || sd.source === 'extras') {
        const settings = getSettings();
        if (settings.cnbEnabled) {
            console.log('[Story-Images] SD source not configured, attempting CNB auto-setup...');
            const ready = await cnbEnsureServiceReady();
            if (ready && extension_settings.sd?.source === 'comfy') {
                console.log('[Story-Images] CNB auto-setup succeeded, source is now comfy');
            } else {
                showToast('图片生成源未配置，请先在Image Generation扩展中选择ComfyUI并配置连接地址，或启用CNB服务自动配置', 'error');
                return null;
            }
        } else {
            showToast('图片生成源未配置，请在Image Generation扩展设置中选择生成源（如ComfyUI）', 'error');
            return null;
        }
    }
    const _generatePicture = await waitForGeneratePicture();
    if (!_generatePicture) {
        console.warn('[Story-Images] generatePicture not available after waiting. SD extension may not be loaded.');
        showToast('图片生成功能不可用 — Image Generation扩展可能未正确加载，请刷新页面后重试', 'error');
        return null;
    }

    const settings = getSettings();
    if (settings.cnbEnabled && sd.source === 'comfy') {
        const serviceReady = await cnbEnsureServiceReady();
        if (!serviceReady) {
            showToast('❌ ComfyUI服务不可用，无法生成图片', 'error');
            return null;
        }
    }

    const canGenerate = await validateBeforeGeneration();
    if (!canGenerate) {
        return null;
    }

    const isDirectMode = (settings.expansionMethod || 'direct') === 'direct';
    const styleConfig = getStyleConfig();
    const modelInfo = getModelMatchInfo(settings.style || 'anime');

    if (sd.source === 'comfy' && !modelInfo.isOptimal && modelInfo.recommendedModel) {
        console.log(`[Story-Images] Model auto-switch: ${modelInfo.currentModelName} -> ${modelInfo.recommendedModelName}`);
        await autoSwitchModel(settings.style || 'anime');
    }

    const expandedPrompt = await expandPrompt(description, charName);
    const quality = assessPromptQuality(expandedPrompt, description, isDirectMode);
    const charNegative = getCharacterNegative(charName);
    const charPrompt = getCharacterPrompt(charName);

    const finalPrompt = buildFinalPrompt(expandedPrompt, charPrompt, charNegative, isDirectMode);

    const activeModelName = modelInfo.currentModelName || '未知';
    console.log(`[Story-Images] Mode: ${isDirectMode ? 'DIRECT(中文)' : 'ENGLISH(翻译)'} | Style: ${styleConfig.label} | Model: ${activeModelName} | Quality: score=${quality.score}, passed=${quality.passed}, missing=[${quality.missing.join(', ')}]`);
    console.log(`[Story-Images] Final prompt: "${finalPrompt.substring(0, 200)}..."`);

    if (!quality.passed) {
        showToast(`提示词质量较低(${quality.score}分)，缺少: ${quality.missing.join(', ')}`, 'info');
    }

    const sdOverrides = {
        free_extend: false,
        command_visible: false,
        prompt_prefix: styleConfig.promptPrefix,
        scale: styleConfig.scale,
        steps: styleConfig.steps,
        sampler: styleConfig.sampler,
    };

    if (styleConfig.negativeExtra) {
        const base = sd.negative_prompt || '';
        if (!base.includes(styleConfig.negativeExtra.trim().substring(2))) {
            sdOverrides.negative_prompt = base + styleConfig.negativeExtra;
        }
    }

    if (styleConfig.workflow && sd.source === 'comfy' && !settings.comfyWorkflow) {
        sdOverrides.comfy_workflow = styleConfig.workflow;
    } else if (settings.comfyWorkflow && sd.source === 'comfy') {
        sdOverrides.comfy_workflow = settings.comfyWorkflow;
    }

    if (sd.source === 'comfy' && sd.model) {
        try {
            const comfyUrl = (sd.comfy_url || 'http://127.0.0.1:8188').replace(/\/+$/, '');
            const resp = await fetch(`${comfyUrl}/object_info/CheckpointLoaderSimple`);
            if (resp.ok) {
                const data = await resp.json();
                const availableModels = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
                if (!availableModels.includes(sd.model)) {
                    const fallback = findBestFallbackModel(availableModels, settings.style || 'anime');
                    if (fallback) {
                        sdOverrides.model = fallback;
                        console.log(`[Story-Images] Model '${sd.model}' not available, overriding to '${fallback}'`);
                    }
                }
            }
        } catch (e) {
            console.warn('[Story-Images] Could not verify model availability:', e.message);
        }
    }

    const args = {};

    if (charNegative) {
        args.negative = charNegative;
    }

    return await withSdSettings(sdOverrides, async () => {
        showToast(`正在生成图片[${styleConfig.label}][${isDirectMode ? '中文直通' : '英文翻译'}]: ${description.substring(0, 30)}...`, 'info');

        let trigger;
        if (isDirectMode) {
            trigger = finalPrompt;
        } else {
            const sceneSpecific = finalPrompt.replace(charPrompt, '').replace(/^,\s*/, '').replace(/,\s*$/, '');
            trigger = `{{charPrefix}}${sceneSpecific}`;
        }

        try {
            let result = await _generatePicture('command', args, trigger);

            logGeneration({
                originalDescription: description,
                expandedPrompt: expandedPrompt,
                finalPrompt: finalPrompt,
                qualityScore: quality.score,
                qualityMissing: quality.missing,
                charName: charName,
                tagType: tagType,
                expansionMethod: isDirectMode ? 'direct' : settings.expansionMethod,
                style: settings.style || 'anime',
                comfyWorkflow: settings.comfyWorkflow || sd.comfy_workflow || 'default',
                success: !!result,
            });

            if (result && !quality.passed && settings.autoRetryOnLowQuality && (settings.maxRetries || 1) > 0) {
                showToast(`提示词质量较低(${quality.score}分)，正在自动重试...`, 'info');
                const retryPrompt = finalPrompt + ', ' + quality.missing.map(m => {
                    const defaults = { subject: '1girl', action: 'standing', clothing: 'dress', expression: 'smile', camera: 'upper_body', setting: 'indoors', lighting: 'soft_lighting' };
                    return defaults[m] || '';
                }).filter(Boolean).join(', ');
                const retryTrigger = isDirectMode ? retryPrompt : trigger;
                result = await _generatePicture('command', args, retryTrigger);
                logGeneration({
                    originalDescription: description,
                    expandedPrompt: expandedPrompt,
                    finalPrompt: retryPrompt,
                    qualityScore: quality.score,
                    charName: charName,
                    tagType: tagType,
                    expansionMethod: isDirectMode ? 'direct' : settings.expansionMethod,
                    style: settings.style || 'anime',
                    success: !!result,
                    retry: true,
                });
            }

            if (result) {
                showToast('图片生成成功!', 'success');
            } else {
                console.warn('[Story-Images] generatePicture returned undefined');
                showToast('图片生成未返回结果', 'error');
            }
            return result;
        } catch (err) {
            console.error('[Story-Images] Generation error:', err);
            showToast(`图片生成失败: ${err.message}`, 'error');

            logGeneration({
                originalDescription: description,
                expandedPrompt: expandedPrompt,
                finalPrompt: finalPrompt,
                qualityScore: quality.score,
                charName: charName,
                tagType: tagType,
                expansionMethod: isDirectMode ? 'direct' : settings.expansionMethod,
                style: settings.style || 'anime',
                success: false,
                error: err.message,
            });

            return null;
        }
    });
}

async function processTagInMessage(messageId) {
    const settings = getSettings();
    if (!settings.enabled || !settings.autoProcessTags) return;

    const message = chat[messageId];
    if (!message || message.is_user || message.is_system) return;

    const text = message.mes;
    if (!text) return;

    if (message.extra?._storyImagesProcessed) return;

    if (processingMessages.has(messageId)) return;
    processingMessages.set(messageId, true);

    message.extra = message.extra || {};
    message.extra._storyImagesProcessed = true;

    const allTags = [];
    for (const tagDef of TAG_REGEXES) {
        const regex = new RegExp(tagDef.regex.source, 'g');
        let match;
        while ((match = regex.exec(text)) !== null) {
            const description = match[1].trim();
            if (!description) continue;
            allTags.push({
                description,
                fullTag: match[0],
                type: tagDef.type,
                label: tagDef.label,
            });
        }
    }

    if (allTags.length === 0) {
        processingMessages.delete(messageId);
        return;
    }

    console.log(`[Story-Images] Found ${allTags.length} tag(s) in message ${messageId}`);

    for (const tag of allTags) {
        console.log(`[Story-Images] Processing ${tag.label}: ${tag.description}`);
        showToast(`检测到[${tag.label}]标签(${allTags.indexOf(tag) + 1}/${allTags.length})，正在生成...`, 'info');

        try {
            const charName = message.name || getCharacterName();
            const result = await generateImageForTag(tag.description, charName, tag.type);

            message.mes = message.mes.replace(tag.fullTag, '').replace(/\n{3,}/g, '\n\n').trim();

            const mesElement = document.querySelector(`.mes[mesid="${messageId}"] .mes_text`);
            if (mesElement) {
                if (settings.removeTagAfterProcess) {
                    mesElement.innerHTML = mesElement.innerHTML.replace(
                        new RegExp(tag.fullTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                        ''
                    );
                } else {
                    const tagSpan = `<span class="si-auto-generated" style="display:inline-flex;align-items:center;gap:4px;color:#8cc8ff;background:rgba(74,158,255,0.1);border-radius:3px;padding:1px 6px;font-size:0.9em;" data-si-mesid="${messageId}" data-si-desc="${escapeHtml(tag.description)}" data-si-type="${escapeHtml(tag.type)}" data-si-label="${escapeHtml(tag.label)}"><span class="si-auto-label">🖼️${escapeHtml(tag.label)}已生成</span><button class="si-regen-btn" title="重新生成图片">🔄</button></span>`;
                    mesElement.innerHTML = mesElement.innerHTML.replace(
                        new RegExp(tag.fullTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                        tagSpan
                    );
                }
            }

            try {
                const context = getContext();
                await context.saveChat();
            } catch (e) { }

            if (result) {
                showToast(`${tag.label}生成成功!`, 'success');
            } else {
                showToast(`${tag.label}生成未返回结果`, 'error');
            }
        } catch (err) {
            console.error('[Story-Images] Tag processing error:', err);
            showToast(`${tag.label}生成失败: ${err.message}`, 'error');
        }
    }

    processingMessages.delete(messageId);
}

function makeTagKey(messageId, description, tagType) {
    return `${messageId}:${tagType}:${description.substring(0, 50)}`;
}

function scanAndInjectButtons(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (settings.autoProcessTags) return;

    const message = chat[messageId];
    if (!message || message.is_user || message.is_system) return;

    const text = message.mes;
    if (!text) return;

    const mesElement = document.querySelector(`.mes[mesid="${messageId}"] .mes_text`);
    if (!mesElement) return;

    let html = mesElement.innerHTML;

    for (const tagDef of TAG_REGEXES) {
        const regex = new RegExp(tagDef.regex.source, 'g');
        let match;
        while ((match = regex.exec(text)) !== null) {
            const description = match[1].trim();
            const fullTag = match[0];

            if (!description) continue;

            const tagKey = makeTagKey(messageId, description, tagDef.type);
            const alreadyGenerated = generatedTagKeys.has(tagKey);

            const escapedTag = fullTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const tagInHtmlRegex = new RegExp(escapedTag);

            if (!tagInHtmlRegex.test(html)) continue;

            const buttonHtml = `<span class="si-manual-injected" data-si-key="${escapeHtml(tagKey)}" data-si-mesid="${messageId}" data-si-desc="${escapeHtml(description)}" data-si-type="${escapeHtml(tagDef.type)}" data-si-label="${escapeHtml(tagDef.label)}" data-si-fulltag="${escapeHtml(fullTag)}">` +
                `<span class="si-tag-text">${escapeHtml(fullTag)}</span>` +
                `<button class="si-gen-btn${alreadyGenerated ? ' si-gen-done' : ''}" title="${alreadyGenerated ? '点击重新生成图片' : '点击生成图片'}">` +
                `<span class="si-gen-btn-icon">${alreadyGenerated ? '🔄' : '🖼️'}</span>` +
                `<span class="si-gen-btn-text">${alreadyGenerated ? '重新生成' : '生成图片'}</span>` +
                `</button></span>`;

            html = html.replace(tagInHtmlRegex, buttonHtml);
        }
    }

    if (html !== mesElement.innerHTML) {
        mesElement.innerHTML = html;
        bindManualButtonEvents(mesElement);
    }
}

function bindManualButtonEvents(container) {
    const buttons = container.querySelectorAll('.si-gen-btn:not(.si-gen-bound)');
    buttons.forEach(btn => {
        btn.classList.add('si-gen-bound');
        btn.addEventListener('click', handleManualGenClick);
    });
}

async function handleManualGenClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const btn = event.currentTarget;
    const wrapper = btn.closest('.si-manual-injected');
    if (!wrapper) return;

    const messageId = parseInt(wrapper.dataset.siMesid);
    const description = wrapper.dataset.siDesc;
    const tagType = wrapper.dataset.siType;
    const tagLabel = wrapper.dataset.siLabel;
    const fullTag = wrapper.dataset.siFulltag;
    const tagKey = wrapper.dataset.siKey;

    if (btn.classList.contains('si-gen-loading')) return;

    btn.classList.remove('si-gen-error', 'si-gen-done');
    btn.classList.add('si-gen-loading');
    btn.disabled = true;
    btn.querySelector('.si-gen-btn-icon').textContent = '⏳';
    btn.querySelector('.si-gen-btn-text').textContent = '生成中...';

    try {
        const message = chat[messageId];
        const charName = message?.name || getCharacterName();
        const result = await generateImageForTag(description, charName, tagType);

        if (result) {
            generatedTagKeys.add(tagKey);
            btn.classList.remove('si-gen-loading');
            btn.classList.add('si-gen-done');
            btn.querySelector('.si-gen-btn-icon').textContent = '🔄';
            btn.querySelector('.si-gen-btn-text').textContent = '重新生成';
            btn.disabled = false;
            btn.title = '点击重新生成图片';

            const settings = getSettings();
            if (settings.removeTagAfterProcess) {
                const mesElement = document.querySelector(`.mes[mesid="${messageId}"] .mes_text`);
                if (mesElement) {
                    const tagTextEl = wrapper.querySelector('.si-tag-text');
                    if (tagTextEl) {
                        tagTextEl.remove();
                    }
                }
                try {
                    const context = getContext();
                    await context.saveChat();
                } catch (e) { }
            }
        } else {
            btn.classList.remove('si-gen-loading');
            btn.classList.add('si-gen-error');
            btn.querySelector('.si-gen-btn-icon').textContent = '❌';
            btn.querySelector('.si-gen-btn-text').textContent = '失败·重试';
            btn.disabled = false;
        }
    } catch (err) {
        console.error('[Story-Images] Manual generation error:', err);
        btn.classList.remove('si-gen-loading');
        btn.classList.add('si-gen-error');
        btn.querySelector('.si-gen-btn-icon').textContent = '❌';
        btn.querySelector('.si-gen-btn-text').textContent = '失败·重试';
        btn.disabled = false;
    }
}

function scanAllVisibleMessages() {
    const settings = getSettings();
    if (!settings.enabled || settings.autoProcessTags) {
        removeAllManualButtons();
        return;
    }

    const mesElements = document.querySelectorAll('.mes[mesid]');
    for (const mesEl of mesElements) {
        const messageId = parseInt(mesEl.getAttribute('mesid'));
        if (!isNaN(messageId)) {
            scanAndInjectButtons(messageId);
        }
    }
}

function removeAllManualButtons() {
    const wrappers = document.querySelectorAll('.si-manual-injected');
    wrappers.forEach(wrapper => {
        const tagText = wrapper.querySelector('.si-tag-text');
        const btn = wrapper.querySelector('.si-gen-btn');
        if (tagText) {
            const textNode = document.createTextNode(tagText.textContent);
            wrapper.parentNode.replaceChild(textNode, wrapper);
        } else {
            wrapper.remove();
        }
    });
}

async function onCharacterMessageRendered(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    if (settings.autoProcessTags) {
        processTagInMessage(messageId);
    } else {
        setTimeout(() => scanAndInjectButtons(messageId), 300);
    }

    processChoiceButtons(messageId);
    bindAutoRegenButtons();
}

function bindAutoRegenButtons() {
    const buttons = document.querySelectorAll('.si-regen-btn:not(.si-regen-bound)');
    buttons.forEach(btn => {
        btn.classList.add('si-regen-bound');
        btn.addEventListener('click', handleAutoRegenClick);
    });
}

async function handleAutoRegenClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const btn = event.currentTarget;
    const wrapper = btn.closest('.si-auto-generated');
    if (!wrapper) return;

    const messageId = parseInt(wrapper.dataset.siMesid);
    const description = wrapper.dataset.siDesc;
    const tagType = wrapper.dataset.siType;
    const tagLabel = wrapper.dataset.siLabel;

    if (btn.classList.contains('si-regen-loading')) return;

    btn.classList.add('si-regen-loading');
    btn.textContent = '⏳';
    btn.title = '正在重新生成...';
    btn.style.pointerEvents = 'none';

    try {
        const message = chat[messageId];
        const charName = message?.name || getCharacterName();
        const result = await generateImageForTag(description, charName, tagType);

        if (result) {
            btn.textContent = '🔄';
            btn.title = '重新生成图片';
            showToast(`✅ ${tagLabel}重新生成成功!`, 'success');
        } else {
            btn.textContent = '🔄';
            btn.title = '重新生成图片';
            showToast(`❌ ${tagLabel}重新生成未返回结果`, 'error');
        }
    } catch (err) {
        console.error('[Story-Images] Auto regen error:', err);
        btn.textContent = '🔄';
        btn.title = '重新生成图片';
        showToast(`❌ ${tagLabel}重新生成失败: ${err.message}`, 'error');
    }

    btn.classList.remove('si-regen-loading');
    btn.style.pointerEvents = '';
}

const CHOICE_BUTTON_REGEX = /\[选择[：:]\s*([^\]]+)\]/g;

function processChoiceButtons(messageId) {
    const message = chat[messageId];
    if (!message || message.is_user || message.is_system) return;

    const mesElement = document.querySelector(`.mes[mesid="${messageId}"] .mes_text`);
    if (!mesElement) return;

    if (mesElement.querySelector('.si-choice-injected')) return;

    const text = message.mes;
    if (!text) return;

    const buttons = [];

    const htmlButtonRegex = /<button[^>]*onclick\s*=\s*["']sendMessage\(['"]([^'"]+)['"]\)["'][^>]*>([^<]*)<\/button>/gi;
    let match;
    while ((match = htmlButtonRegex.exec(text)) !== null) {
        buttons.push({ fullMatch: match[0], sendText: match[1], label: match[2].trim() });
    }

    const encodedButtonRegex = /&lt;button[^&]*onclick[^&]*sendMessage[^&]*&gt;([^&]*)&lt;\/button&gt;/gi;
    while ((match = encodedButtonRegex.exec(text)) !== null) {
        const label = match[1].trim();
        if (label) {
            buttons.push({ fullMatch: match[0], sendText: label, label: label });
        }
    }

    const choiceRegex = new RegExp(CHOICE_BUTTON_REGEX.source, 'g');
    let choiceMatch;
    while ((choiceMatch = choiceRegex.exec(text)) !== null) {
        const content = choiceMatch[1];
        const parts = content.split('|').map(p => p.trim()).filter(p => p);
        for (const part of parts) {
            const cnColon = part.indexOf('：');
            const enColon = part.indexOf(':');
            const sepIdx = cnColon >= 0 ? cnColon : enColon >= 0 ? enColon : -1;
            if (sepIdx >= 0) {
                buttons.push({ label: part.substring(0, sepIdx).trim(), sendText: part.substring(sepIdx + 1).trim() });
            } else {
                buttons.push({ label: part, sendText: part });
            }
        }
    }

    if (buttons.length === 0) {
        const NON_CHOICE_PATTERNS = [
            /【风险提示】/, /【系统提示】/, /【警告】/, /【注意】/, /【提示】/,
            /【设定】/, /【状态】/, /【属性】/, /【能力】/, /【技能】/,
            /【装备】/, /【物品】/, /【任务】/, /【成就】/, /【日志】/,
        ];
        const hasNonChoice = NON_CHOICE_PATTERNS.some(p => p.test(text));
        if (hasNonChoice) {
            return;
        }

        const MAX_OPTION_LENGTH = 80;

        const lines = text.split('\n');
        const letteredLines = [];
        const numberedLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (/^[A-Za-z][.、)\s]+/.test(trimmed)) {
                letteredLines.push(trimmed);
            } else if (/^\d+[.、)\s]+/.test(trimmed)) {
                numberedLines.push(trimmed);
            }
        }

        if (letteredLines.length >= 2 && letteredLines.length <= 8) {
            const isConsecutive = letteredLines.every((l, i) => {
                const letter = l.match(/^([A-Za-z])/)?.[1]?.toUpperCase();
                return letter && letter.charCodeAt(0) - 65 === i;
            });
            if (isConsecutive) {
                const validLines = letteredLines.filter(l => {
                    const m = l.match(/^[A-Za-z][.、)\s]+(.+)/);
                    return m && m[1].trim().length <= MAX_OPTION_LENGTH;
                });
                if (validLines.length === letteredLines.length) {
                    for (const line of letteredLines) {
                        const m = line.match(/^[A-Za-z][.、)\s]+(.+)/);
                        if (m) {
                            buttons.push({ fullMatch: null, sendText: m[1].trim(), label: m[1].trim() });
                        }
                    }
                }
            }
        }

        if (buttons.length === 0 && numberedLines.length >= 2 && numberedLines.length <= 8) {
            const isConsecutive = numberedLines.every((l, i) => {
                const num = l.match(/^(\d+)/)?.[1];
                return num && parseInt(num) === i + 1;
            });
            if (isConsecutive) {
                const validLines = numberedLines.filter(l => {
                    const m = l.match(/^\d+[.、)\s]+(.+)/);
                    return m && m[1].trim().length <= MAX_OPTION_LENGTH;
                });
                if (validLines.length === numberedLines.length) {
                    for (const line of numberedLines) {
                        const m = line.match(/^\d+[.、)\s]+(.+)/);
                        if (m) {
                            buttons.push({ fullMatch: null, sendText: m[1].trim(), label: m[1].trim() });
                        }
                    }
                }
            }
        }
    }

    if (buttons.length === 0) return;

    console.log(`[Story-Images] Found ${buttons.length} choice button(s) in message ${messageId}`);

    let html = mesElement.innerHTML;

    for (const btn of buttons) {
        if (btn.fullMatch) {
            const escaped = btn.fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            try { html = html.replace(new RegExp(escaped), ''); } catch (e) { }
        }
    }

    const choiceRegex2 = new RegExp(CHOICE_BUTTON_REGEX.source, 'g');
    html = html.replace(choiceRegex2, '');

    html = html.replace(/&lt;button[^&]*&gt;[^&]*&lt;\/button&gt;/gi, '');

    const domButtons = mesElement.querySelectorAll('button:not(.si-choice-btn):not(.si-gen-btn):not(.menu_button)');
    domButtons.forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes('sendMessage')) {
            btn.remove();
        }
    });

    const buttonsHtml = buttons.map((btn, idx) => {
        const escapedSend = escapeHtml(btn.sendText);
        const escapedLabel = escapeHtml(btn.label);
        return `<div class="si-choice-option" data-si-send="${escapedSend}" data-si-mesid="${messageId}" title="点击选择: ${escapedSend}">` +
            `<span class="si-choice-key">${String.fromCharCode(65 + idx)}</span>` +
            `<span class="si-choice-label">${escapedLabel}</span>` +
            `</div>`;
    }).join('');

    const containerHtml = `<div class="si-choice-injected si-choice-box">${buttonsHtml}</div>`;

    html = html.trimEnd();
    html += containerHtml;

    mesElement.innerHTML = html;
    bindChoiceButtonEvents(mesElement);
}

function bindChoiceButtonEvents(container) {
    const options = container.querySelectorAll('.si-choice-option:not(.si-choice-bound)');
    options.forEach(opt => {
        opt.classList.add('si-choice-bound');
        opt.addEventListener('click', handleChoiceOptionClick);
    });
}

async function handleChoiceOptionClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const opt = event.currentTarget;
    const sendText = opt.dataset.siSend;
    const messageId = parseInt(opt.dataset.siMesid);

    if (!sendText) return;

    if (opt.classList.contains('si-choice-sending')) return;

    const container = opt.closest('.si-choice-box');
    if (container) {
        container.querySelectorAll('.si-choice-option').forEach(o => {
            o.classList.add('si-choice-sending');
            o.style.pointerEvents = 'none';
        });
    }

    opt.classList.add('si-choice-sending');
    const keyEl = opt.querySelector('.si-choice-key');
    const labelEl = opt.querySelector('.si-choice-label');
    const originalKey = keyEl?.textContent || '';
    if (keyEl) keyEl.textContent = '⏳';

    try {
        await sendMessageAsUser(sendText);
        await Generate('normal');

        if (container) {
            container.querySelectorAll('.si-choice-option').forEach(o => {
                o.classList.remove('si-choice-sending');
                o.classList.add('si-choice-disabled');
                const k = o.querySelector('.si-choice-key');
                if (k) k.textContent = o === opt ? '✓' : '—';
            });
        }
        opt.classList.add('si-choice-selected');
    } catch (err) {
        console.error('[Story-Images] Choice option send error:', err);
        if (container) {
            container.querySelectorAll('.si-choice-option').forEach(o => {
                o.classList.remove('si-choice-sending');
                o.style.pointerEvents = '';
            });
        }
        if (keyEl) keyEl.textContent = originalKey;
        showToast(`发送失败: ${err.message}`, 'error');
    }
}

async function initStoryCommand(args, description) {
    const charName = getCharacterName();
    if (!charName) {
        showToast('请先选择一个角色', 'error');
        return '';
    }
    showToast('正在初始化故事画像...', 'info');
    const portraitDesc = description || `${charName} character portrait, full body standing pose`;
    try {
        await generateImageForTag(portraitDesc, charName, 'portrait');
    } catch (e) { }
    return '故事画像初始化完成';
}

async function genPortraitCommand(args, description) {
    const charName = args?.character || getCharacterName();
    const prompt = description || `${charName} detailed character portrait, full body standing pose`;
    const sd = extension_settings.sd;
    const savedW = sd?.width;
    const savedH = sd?.height;
    if (sd) { sd.width = 768; sd.height = 1024; }
    try {
        await generateImageForTag(prompt, charName, 'portrait');
    } finally {
        if (sd && savedW && savedH) { sd.width = savedW; sd.height = savedH; }
    }
    return `人物画像已生成: ${prompt}`;
}

async function genSceneCommand(args, description) {
    if (!description) { showToast('请提供场景描述', 'error'); return ''; }
    const sd = extension_settings.sd;
    const savedW = sd?.width;
    const savedH = sd?.height;
    if (sd) { sd.width = 1024; sd.height = 576; }
    try {
        const charName = getCharacterName();
        await generateImageForTag(`background scenery, ${description}, no humans`, charName, 'scene');
    } finally {
        if (sd && savedW && savedH) { sd.width = savedW; sd.height = savedH; }
    }
    return `场景画像已生成: ${description}`;
}

async function genInteractCommand(args, description) {
    if (!description) { showToast('请提供交互描述', 'error'); return ''; }
    const charName = getCharacterName();
    await generateImageForTag(description, charName, 'interact');
    return `交互图片已生成: ${description}`;
}

async function genAnimateCommand(args, description) {
    if (!description) { showToast('请提供动画描述', 'error'); return ''; }
    const charName = getCharacterName();
    await generateImageForTag(`dynamic action, motion blur, ${description}`, charName, 'animated');
    return `动图已生成: ${description}`;
}

async function testExpansionCommand(args, description) {
    if (!description) { showToast('请提供测试描述', 'error'); return ''; }
    const charName = getCharacterName();
    const settings = getSettings();
    const isDirectMode = (settings.expansionMethod || 'direct') === 'direct';
    const styleConfig = getStyleConfig();
    showToast(`正在测试文字扩展[${styleConfig.label}][${isDirectMode ? '中文直通' : '英文翻译'}]...`, 'info');
    try {
        const expanded = await expandPrompt(description, charName);
        const quality = assessPromptQuality(expanded, description, isDirectMode);
        const resultMsg = `【模式】${isDirectMode ? '中文直通' : '英文翻译'}\n【风格】${styleConfig.label}\n【原始描述】${description}\n【扩展结果】${expanded}\n【质量评分】${quality.score}/100\n【缺少要素】${quality.missing.length > 0 ? quality.missing.join(', ') : '无'}\n【通过】${quality.passed ? '是' : '否'}`;
        showToast(`扩展完成! 评分: ${quality.score}/100`, quality.passed ? 'success' : 'info');
        return resultMsg;
    } catch (err) {
        showToast(`扩展测试失败: ${err.message}`, 'error');
        return `扩展失败: ${err.message}`;
    }
}

async function compareModesCommand(args, description) {
    if (!description) { showToast('请提供对比测试描述', 'error'); return ''; }
    const charName = getCharacterName();
    const settings = getSettings();
    const savedMethod = settings.expansionMethod;

    let directResult = '';
    let englishResult = '';

    settings.expansionMethod = 'direct';
    try {
        const expanded = await expandPrompt(description, charName);
        const quality = assessPromptQuality(expanded, description, true);
        directResult = `【中文直通模式】\n提示词: ${expanded}\n质量评分: ${quality.score}/100\n缺少: ${quality.missing.join(', ') || '无'}`;
    } catch (e) {
        directResult = `【中文直通模式】失败: ${e.message}`;
    }

    settings.expansionMethod = 'ollama';
    try {
        const expanded = await expandPrompt(description, charName);
        const quality = assessPromptQuality(expanded, description, false);
        englishResult = `\n\n【英文翻译模式】\n提示词: ${expanded}\n质量评分: ${quality.score}/100\n缺少: ${quality.missing.join(', ') || '无'}`;
    } catch (e) {
        englishResult = `\n\n【英文翻译模式】失败: ${e.message}`;
    }

    settings.expansionMethod = savedMethod;
    saveSettingsDebounced();

    return `【对比测试】原始描述: ${description}\n\n${directResult}${englishResult}`;
}

async function testOllamaConnection() {
    const settings = getSettings();
    const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
    try {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const models = (data.models || []).map(m => m.name);
        cachedOllamaModels = models;
        showToast(`Ollama连接成功! 可用模型: ${models.join(', ') || '无'}`, 'success');
        return models;
    } catch (e) {
        showToast(`Ollama连接失败: ${e.message}`, 'error');
        return [];
    }
}

async function testComfyConnectionCommand() {
    const sd = extension_settings.sd;
    const comfyUrl = sd?.comfy_url || 'http://127.0.0.1:8188';
    const settings = getSettings();

    let result = `【ComfyUI连接测试】\n`;
    result += `ComfyUI URL: ${comfyUrl}\n`;
    result += `生成源: ${sd?.source || '未配置'}\n`;
    result += `CNB自动唤醒: ${settings.cnbEnabled ? '已启用' : '未启用'}\n`;

    if (settings.cnbEnabled) {
        result += `Forwarded Address: ${cnbServiceState.pipelineId ? `https://${cnbServiceState.pipelineId}-8188.cnb.run/` : '未获取'}\n`;
        result += `CNB服务状态: ${cnbServiceState.status}\n`;
        result += `自动唤醒: ${settings.cnbAutoWake ? '已启用' : '未启用'}\n`;
        result += `保持活跃: ${settings.cnbKeepAlive ? '已启用' : '未启用'}\n`;
    }

    const status = await cnbCheckComfyStatus(comfyUrl);
    if (status.online) {
        result += `\n✅ ComfyUI服务在线`;
        if (status.data) {
            const sys = status.data.system_config || {};
            result += `\n设备: ${sys.devices?.[0]?.name || '未知'}`;
            result += `\nVRAM: ${sys.devices?.[0]?.vram_total ? Math.round(sys.devices[0].vram_total / 1024 / 1024) + 'MB' : '未知'}`;
        }
        showToast('✅ ComfyUI连接成功!', 'success');
    } else {
        result += `\n❌ ComfyUI服务离线 (${status.error || '无法连接'})`;
        if (settings.cnbEnabled && settings.cnbAutoWake) {
            result += `\n正在尝试自动启动...`;
            showToast('ComfyUI离线，正在尝试启动...', 'info');
            const wakeSuccess = await cnbAutoSetup();
            result += wakeSuccess ? `\n✅ 启动成功!` : `\n❌ 启动失败`;
        }
        showToast('❌ ComfyUI连接失败', 'error');
    }

    return result;
}

async function cnbWakeCommand() {
    const settings = getSettings();
    if (!settings.cnbEnabled) {
        return 'CNB服务管理未启用，请在设置中开启';
    }
    if (!settings.cnbApiToken || !settings.cnbRepoPath) {
        return 'CNB API Token或仓库路径未配置，请先在设置中填写';
    }

    showToast('正在启动CNB ComfyUI服务...', 'info');
    const success = await cnbAutoSetup();
    return success ? '✅ CNB ComfyUI服务启动成功!' : '❌ CNB ComfyUI服务启动失败，请检查配置和服务状态';
}

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'init-story',
        callback: initStoryCommand,
        aliases: ['storyinit'],
        returns: 'Initialization result',
        namedArgumentList: [],
        unnamedArgumentList: [
            new SlashCommandArgument('scene description', [ARGUMENT_TYPE.STRING], false, false, '', 'Optional scene description'),
        ],
        helpString: 'Initialize story by generating character portrait',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'gen-portrait',
        callback: genPortraitCommand,
        aliases: ['portrait'],
        returns: 'Portrait generation result',
        namedArgumentList: [
            new SlashCommandNamedArgument('character', 'Character name', [ARGUMENT_TYPE.STRING], false, false, ''),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument('description', [ARGUMENT_TYPE.STRING], false, false, '', 'Portrait description'),
        ],
        helpString: 'Generate a character portrait with LLM text expansion',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'gen-scene',
        callback: genSceneCommand,
        aliases: ['scene'],
        returns: 'Scene generation result',
        namedArgumentList: [],
        unnamedArgumentList: [
            new SlashCommandArgument('description', [ARGUMENT_TYPE.STRING], true, false, '', 'Scene description'),
        ],
        helpString: 'Generate a scene background with LLM text expansion',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'gen-interact',
        callback: genInteractCommand,
        aliases: ['interact'],
        returns: 'Interaction image result',
        namedArgumentList: [],
        unnamedArgumentList: [
            new SlashCommandArgument('description', [ARGUMENT_TYPE.STRING], true, false, '', 'Interaction description'),
        ],
        helpString: 'Generate an interaction image with LLM text expansion',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'gen-animate',
        callback: genAnimateCommand,
        aliases: ['animate', 'gif'],
        returns: 'Animation generation result',
        namedArgumentList: [],
        unnamedArgumentList: [
            new SlashCommandArgument('description', [ARGUMENT_TYPE.STRING], true, false, '', 'Animation description'),
        ],
        helpString: 'Generate an animated image with LLM text expansion',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'test-expansion',
        callback: testExpansionCommand,
        aliases: ['testexpand'],
        returns: 'Expansion test result',
        namedArgumentList: [],
        unnamedArgumentList: [
            new SlashCommandArgument('description', [ARGUMENT_TYPE.STRING], true, false, '', 'Chinese description to test'),
        ],
        helpString: 'Test the text expansion module without generating an image',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'gen-avatar',
        callback: async function() {
            const result = await generateAvatarImage();
            return result ? '头像生成成功' : '头像生成失败';
        },
        aliases: ['avatar'],
        returns: 'Avatar generation result',
        namedArgumentList: [],
        unnamedArgumentList: [],
        helpString: 'Generate an avatar for the current character card',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'compare-modes',
        callback: compareModesCommand,
        aliases: ['cmpmode'],
        returns: 'Mode comparison result',
        namedArgumentList: [],
        unnamedArgumentList: [
            new SlashCommandArgument('description', [ARGUMENT_TYPE.STRING], true, false, '', 'Chinese description to compare'),
        ],
        helpString: 'Compare Chinese direct vs English translation modes without generating images',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'test-comfy',
        callback: testComfyConnectionCommand,
        aliases: ['comfytest'],
        returns: 'ComfyUI connection test result',
        namedArgumentList: [],
        unnamedArgumentList: [],
        helpString: 'Test ComfyUI connection and CNB auto-wake status',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cnb-wake',
        callback: cnbWakeCommand,
        aliases: ['cnb-start', 'wake'],
        returns: 'CNB service start result',
        namedArgumentList: [],
        unnamedArgumentList: [],
        helpString: 'Start CNB ComfyUI workspace service',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cnb-stop',
        callback: async () => {
            const success = await cnbStopService();
            return success ? '✅ CNB ComfyUI服务已停止' : '❌ 停止服务失败';
        },
        aliases: [],
        returns: 'CNB service stop result',
        namedArgumentList: [],
        unnamedArgumentList: [],
        helpString: 'Stop CNB ComfyUI workspace service',
    }));
}

function initDefaultCharacterPrompts() {
    const settings = getSettings();
    if (Object.keys(settings.characterPrompts).length > 0) return;
    settings.characterPrompts = {};
    settings.characterNegatives = {};
    saveSettingsDebounced();
}

async function loadSettingsUI() {
    const settings = getSettings();
    const container = document.getElementById('story_images_settings_container');
    if (!container) return;

    const logCount = (settings.generationLog || []).length;
    const lastLog = (settings.generationLog || []).slice(-1)[0];
    const lastQuality = lastLog ? `${lastLog.qualityScore || 'N/A'}/100` : 'N/A';
    const lastMethod = lastLog?.expansionMethod || 'N/A';
    const lastStyle = lastLog?.style || 'N/A';
    const isDirectMode = (settings.expansionMethod || 'direct') === 'direct';
    const currentStyle = settings.style || 'anime';
    const styleConfig = getStyleConfig();

    const ollamaModels = cachedOllamaModels || [];
    const comfyWorkflows = cachedComfyWorkflows || [];

    let styleSelectorHtml = '<div class="si-style-selector" style="display: flex; gap: 6px; margin: 6px 0;">';
    for (const [key, config] of Object.entries(STYLE_CONFIGS)) {
        const isActive = currentStyle === key;
        styleSelectorHtml += `
            <div class="si-style-card${isActive ? ' si-style-active' : ''}" data-style="${key}"
                 style="flex: 1; padding: 8px 4px; text-align: center; border-radius: 6px; cursor: pointer;
                        border: 2px solid ${isActive ? '#4a9eff' : '#444'}; background: ${isActive ? 'rgba(74,158,255,0.2)' : 'rgba(0,0,0,0.2)'};
                        transition: all 0.2s ease; user-select: none;">
                <div style="font-size: 20px; margin-bottom: 2px;">${config.icon}</div>
                <div style="font-size: 12px; font-weight: ${isActive ? 'bold' : 'normal'}; color: ${isActive ? '#4a9eff' : '#aaa'};">${config.label}</div>
            </div>`;
    }
    styleSelectorHtml += '</div>';

    let workflowOptionsHtml = '<option value="">跟随SD扩展默认</option>';
    for (const wf of comfyWorkflows) {
        const desc = WORKFLOW_DESCRIPTIONS[wf];
        const label = desc ? `${desc.core} — ${desc.advantage}` : wf.replace(/\.json$/, '').replace(/_/g, ' ');
        const selected = settings.comfyWorkflow === wf ? 'selected' : '';
        workflowOptionsHtml += `<option value="${wf}" ${selected}>${label}</option>`;
    }

    let modelOptionsHtml = '';
    if (ollamaModels.length > 0) {
        for (const model of ollamaModels) {
            const selected = settings.ollamaModel === model ? 'selected' : '';
            modelOptionsHtml += `<option value="${model}" ${selected}>${model}</option>`;
        }
    } else {
        const currentModel = settings.ollamaModel || '';
        if (currentModel) {
            modelOptionsHtml = `<option value="${currentModel}" selected>${currentModel}</option>`;
        } else {
            modelOptionsHtml = '<option value="">点击刷新获取模型列表</option>';
        }
    }

    const remoteApiModels = cachedRemoteApiModels || [];
    const currentPreset = REMOTE_API_PRESETS.find(p => p.key === settings.remoteApiFormat) || REMOTE_API_PRESETS[0];

    let remoteModelOptionsHtml = '';
    if (remoteApiModels.length > 0) {
        for (const model of remoteApiModels) {
            const selected = settings.remoteApiModel === model ? 'selected' : '';
            remoteModelOptionsHtml += `<option value="${escapeHtml(model)}" ${selected}>${escapeHtml(model)}</option>`;
        }
    } else if (currentPreset.models.length > 0) {
        for (const model of currentPreset.models) {
            const selected = settings.remoteApiModel === model ? 'selected' : '';
            remoteModelOptionsHtml += `<option value="${escapeHtml(model)}" ${selected}>${escapeHtml(model)}</option>`;
        }
    } else {
        const currentModel = settings.remoteApiModel || '';
        if (currentModel) {
            remoteModelOptionsHtml = `<option value="${escapeHtml(currentModel)}" selected>${escapeHtml(currentModel)}</option>`;
        } else {
            remoteModelOptionsHtml = '<option value="">点击刷新或手动输入</option>';
        }
    }

    const isRemoteApiMode = settings.expansionMethod === 'remote_api';
    const isOllamaMode = settings.expansionMethod === 'ollama';
    const showApiConfig = isRemoteApiMode || isOllamaMode;

    container.innerHTML = `
        <div class="story-images-settings">
            <h4>📷 图片功能辅助 v2.4.0</h4>
            <div style="margin: 8px 0; padding: 8px; background: rgba(74,158,255,0.1); border-radius: 4px; font-size: 12px;">
                <strong>可用指令：</strong><br>
                <code>/init-story [场景]</code> - 初始化故事画像<br>
                <code>/gen-portrait [描述]</code> - 生成人物画像<br>
                <code>/gen-scene &lt;描述&gt;</code> - 生成场景画像<br>
                <code>/gen-interact &lt;描述&gt;</code> - 生成交互图片<br>
                <code>/gen-animate &lt;描述&gt;</code> - 生成动图<br>
                <code>/test-expansion &lt;描述&gt;</code> - 测试当前模式<br>
                <code>/compare-modes &lt;描述&gt;</code> - 对比中英文模式<br>
                <code>/test-comfy</code> - 测试ComfyUI连接及CNB状态<br>
                <code>/cnb-wake</code> 或 <code>/cnb-start</code> - 启动CNB ComfyUI服务<br>
                <code>/cnb-stop</code> - 停止CNB ComfyUI服务<br>
                <br>
                <strong>自动识别标签：</strong><br>
                [图片：描述] [动图：描述] [📸图库新增：描述] [微信图片：描述]
            </div>

            <h4>⚙️ 基本设置</h4>
            <label><input type="checkbox" id="si_enabled" ${settings.enabled ? 'checked' : ''}> 启用自动图片生成</label>
            <label><input type="checkbox" id="si_auto_tags" ${settings.autoProcessTags ? 'checked' : ''}> 自动处理标签</label>
            <div style="margin: 2px 0 4px 20px; padding: 4px 8px; background: rgba(${settings.autoProcessTags ? '0,200,100,0.1' : '255,200,0,0.1'}); border-radius: 4px; font-size: 11px; color: ${settings.autoProcessTags ? '#00c864' : '#ffc800'};">
                ${settings.autoProcessTags ? '自动模式 — 检测到标签后自动生成图片' : '手动模式 — 标签旁显示「生成图片」按钮，点击后生成'}
            </div>
            <label><input type="checkbox" id="si_remove_tag" ${settings.removeTagAfterProcess ? 'checked' : ''}> 生成后移除原文标签</label>
            <label><input type="checkbox" id="si_show_toasts" ${settings.showToasts ? 'checked' : ''}> 显示状态提示</label>

            <h4>🎨 生图风格</h4>
            ${styleSelectorHtml}
            <div style="margin: 4px 0; padding: 6px; background: rgba(74,158,255,0.1); border-radius: 4px; font-size: 11px; color: #4a9eff;">
                当前: ${styleConfig.icon} ${styleConfig.label} — ${styleConfig.description}<br>
                <span style="color: ${getModelMatchInfo(currentStyle).isOptimal ? '#00c864' : '#ffc800'};">推荐模型: ${getModelMatchInfo(currentStyle).recommendedModelName}</span>
                <span style="color: ${getModelMatchInfo(currentStyle).isOptimal ? '#00c864' : '#ff5050'};"> | 当前: ${getModelMatchInfo(currentStyle).currentModelName}</span>
                ${getModelMatchInfo(currentStyle).isOptimal ? '<span style="color: #00c864;"> ✓ 最佳匹配</span>' : '<span style="color: #ffc800;"> ⚠ 建议切换</span>'}<br>
                <span style="color: #888;">前缀: ${styleConfig.promptPrefix}</span><br>
                <span style="color: #888;">参数: CFG=${styleConfig.scale} Steps=${styleConfig.steps} Sampler=${styleConfig.sampler} Size=${styleConfig.size || '默认'}</span><br>
                <span style="color: #888; font-size: 10px;">💡 ${styleConfig.tip || ''}</span>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 6px;">
                <button id="si_sync_style_to_sd" class="si-action-btn" style="flex: 1; background: linear-gradient(135deg, rgba(74,158,255,0.2), rgba(0,200,100,0.2)); border-color: rgba(74,158,255,0.4); color: #4a9eff; font-weight: bold;">
                    <span class="si-action-icon">🔄</span><span class="si-action-text">同步风格到SD扩展</span>
                </button>
            </div>
            <div id="si_sync_style_status" style="margin-top: 4px; font-size: 11px; display: none;"></div>

            <h4>🔄 ComfyUI工作流</h4>
            <label style="display:block; margin: 4px 0;">
                工作流选择:
                <select id="si_comfy_workflow" style="width: 100%; margin-top: 2px;">
                    ${workflowOptionsHtml}
                </select>
            </label>
            <button id="si_refresh_workflows" class="si-action-btn si-action-refresh"><span class="si-action-icon">🔄</span><span class="si-action-text">刷新工作流列表</span></button>
            <div id="si_workflow_info" style="margin: 4px 0; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; color: #aaa; display: none;"></div>

            <h4>☁️ CNB ComfyUI 服务管理</h4>
            <div style="margin: 4px 0; padding: 6px; background: rgba(74,158,255,0.1); border-radius: 4px; font-size: 11px; color: #8cc8ff;">
                一键启动CNB云原生ComfyUI环境，自动完成Token验证、环境创建、URL提取和连接测试
            </div>
            <label><input type="checkbox" id="si_cnb_enabled" ${settings.cnbEnabled ? 'checked' : ''}> 启用CNB服务管理</label>
            <div id="si_cnb_config" style="display: ${settings.cnbEnabled ? 'block' : 'none'}; margin: 6px 0; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(71,85,105,0.3); border-radius: 6px;">
                <div id="si_cnb_status" style="margin-bottom: 8px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px;">
                    <span style="color: #888;">⚪ 未检测</span>
                </div>
                <div style="margin-bottom: 8px; padding: 6px; background: rgba(74,158,255,0.08); border: 1px solid rgba(74,158,255,0.2); border-radius: 4px;">
                    <div style="font-size: 11px; font-weight: bold; color: #8cc8ff; margin-bottom: 4px;">🔑 API认证配置</div>
                    <label style="display:block; margin: 4px 0;">
                        CNB API Token:
                        <input type="password" id="si_cnb_api_token" value="${escapeHtml(settings.cnbApiToken || '')}" placeholder="在 cnb.cool 个人设置 → 访问令牌 中获取" style="margin-top: 2px;">
                        <div style="font-size: 10px; color: #666; margin-top: 2px;">从 cnb.cool 个人设置 → 访问令牌 创建，需勾选workspace权限</div>
                    </label>
                    <button id="si_cnb_test_token" class="si-action-btn si-action-test" style="margin-top: 4px;"><span class="si-action-icon">🔑</span><span class="si-action-text">验证Token</span></button>
                </div>
                <div style="margin-bottom: 8px; padding: 6px; background: rgba(0,200,100,0.05); border: 1px solid rgba(0,200,100,0.15); border-radius: 4px;">
                    <div style="font-size: 11px; font-weight: bold; color: #86efac; margin-bottom: 4px;">📦 仓库配置</div>
                    <label style="display:block; margin: 4px 0;">
                        仓库路径:
                        <select id="si_cnb_repo_select" style="display: ${settings.cnbApiToken ? 'block' : 'none'}; margin-top: 2px; width: 100%;">
                            <option value="">-- 验证Token后加载仓库列表 --</option>
                            ${settings.cnbRepoPath ? `<option value="${escapeHtml(settings.cnbRepoPath)}" selected>${escapeHtml(settings.cnbRepoPath)}</option>` : ''}
                        </select>
                        <input type="text" id="si_cnb_repo_path" value="${escapeHtml(settings.cnbRepoPath || '')}" placeholder="组织名/仓库名 (如 my-org/comfyui-workspace)" style="margin-top: 2px; ${settings.cnbApiToken ? 'display:none;' : ''}">
                        <div style="font-size: 10px; color: #666; margin-top: 2px;">CNB平台上ComfyUI项目的仓库路径，格式: 组织/仓库</div>
                    </label>
                    <label style="display:block; margin: 4px 0;">
                        分支:
                        <select id="si_cnb_branch_select" style="display: ${settings.cnbApiToken && settings.cnbRepoPath ? 'block' : 'none'}; margin-top: 2px; width: 100%;">
                            <option value="">-- 选择仓库后加载分支列表 --</option>
                            ${settings.cnbBranch ? `<option value="${escapeHtml(settings.cnbBranch)}" selected>${escapeHtml(settings.cnbBranch)}</option>` : ''}
                        </select>
                        <input type="text" id="si_cnb_branch" value="${escapeHtml(settings.cnbBranch || 'main')}" placeholder="main" style="margin-top: 2px; ${settings.cnbApiToken && settings.cnbRepoPath ? 'display:none;' : ''}">
                    </label>
                </div>
                <div style="margin-bottom: 8px; padding: 6px; background: rgba(74,158,255,0.05); border: 1px solid rgba(74,158,255,0.15); border-radius: 4px;">
                    <div style="font-size: 11px; font-weight: bold; color: #4a9eff; margin-bottom: 4px;">🌐 ComfyUI Forwarded Address</div>
                    <div id="si_cnb_forwarded_address" style="font-size: 11px; color: #94a3b8; word-break: break-all; min-height: 16px; padding: 2px 4px; background: rgba(0,0,0,0.2); border-radius: 3px;">${cnbServiceState.pipelineId ? `https://${cnbServiceState.pipelineId}-8188.cnb.run/` : '服务未启动'}</div>
                    <div style="font-size: 10px; color: #666; margin-top: 2px;">ComfyUI完全启动后自动获取的转发地址（cnb.run格式）</div>
                </div>
                <label><input type="checkbox" id="si_cnb_auto_wake" ${settings.cnbAutoWake ? 'checked' : ''}> 自动启动（检测到离线时自动启动服务）</label>
                <label style="display:block; margin: 4px 0;">
                    启动超时:
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                        <input type="range" id="si_cnb_wake_timeout" min="30" max="300" step="10" value="${settings.cnbWakeTimeout || 120}" style="flex: 1;">
                        <span id="si_cnb_wake_timeout_display" style="font-size: 11px; color: #94a3b8; min-width: 40px;">${settings.cnbWakeTimeout || 120}秒</span>
                    </div>
                    <div style="font-size: 10px; color: #666; margin-top: 2px;">等待CNB服务启动的最长时间，CNB冷启动通常需要60-180秒</div>
                </label>
                <label style="display:block; margin: 4px 0;">
                    轮询间隔:
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                        <input type="range" id="si_cnb_poll_interval" min="3" max="30" step="1" value="${settings.cnbPollInterval || 5}" style="flex: 1;">
                        <span id="si_cnb_poll_interval_display" style="font-size: 11px; color: #94a3b8; min-width: 30px;">${settings.cnbPollInterval || 5}秒</span>
                    </div>
                    <div style="font-size: 10px; color: #666; margin-top: 2px;">启动过程中检测服务状态的间隔时间</div>
                </label>
                <label><input type="checkbox" id="si_cnb_keep_alive" ${settings.cnbKeepAlive ? 'checked' : ''}> 保持活跃（定期ping防止休眠）</label>
                <div id="si_cnb_keep_alive_config" style="display: ${settings.cnbKeepAlive ? 'block' : 'none'}; margin: 4px 0 4px 20px;">
                    <label style="display:block; margin: 4px 0;">
                        保活间隔:
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                            <input type="range" id="si_cnb_keep_alive_interval" min="60" max="600" step="30" value="${settings.cnbKeepAliveInterval || 300}" style="flex: 1;">
                            <span id="si_cnb_keep_alive_interval_display" style="font-size: 11px; color: #94a3b8; min-width: 40px;">${settings.cnbKeepAliveInterval || 300}秒</span>
                        </div>
                        <div style="font-size: 10px; color: #666; margin-top: 2px;">定期发送请求保持服务活跃，间隔过短可能消耗更多资源</div>
                    </label>
                </div>
                <label><input type="checkbox" id="si_cnb_auto_stop" ${settings.cnbAutoStop ? 'checked' : ''}> 自动停止（空闲时自动关闭服务节省核时）</label>
                <div id="si_cnb_auto_stop_config" style="display: ${settings.cnbAutoStop ? 'block' : 'none'}; margin: 4px 0 4px 20px;">
                    <label style="display:block; margin: 4px 0;">
                        空闲超时:
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                            <input type="range" id="si_cnb_auto_stop_delay" min="5" max="120" step="5" value="${settings.cnbAutoStopDelay || 30}" style="flex: 1;">
                            <span id="si_cnb_auto_stop_delay_display" style="font-size: 11px; color: #94a3b8; min-width: 40px;">${settings.cnbAutoStopDelay || 30}分钟</span>
                        </div>
                        <div style="font-size: 10px; color: #666; margin-top: 2px;">无图片生成请求超过此时间后自动停止Workspace，节省CNB核时费用</div>
                    </label>
                </div>
                <div class="si-setup-actions">
                    <button id="si_cnb_start_service" class="si-action-btn si-action-test" style="font-weight: bold; padding: 8px 18px;"><span class="si-action-icon">🚀</span><span class="si-action-text">一键启动</span></button>
                    <button id="si_cnb_stop_service" class="si-action-btn" style="border-color: rgba(255,80,80,0.35); color: #ff8080;"><span class="si-action-icon">⏹️</span><span class="si-action-text">停止服务</span></button>
                    <button id="si_cnb_check_status" class="si-action-btn si-action-refresh"><span class="si-action-icon">🔍</span><span class="si-action-text">检测状态</span></button>
                </div>
                <div id="si_cnb_steps" style="display: none; margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(74,158,255,0.15); border-radius: 6px;">
                    <div style="font-size: 11px; font-weight: bold; color: #8cc8ff; margin-bottom: 6px;">📋 自动化流程进度</div>
                    <div id="si_cnb_step_list">
                        <div class="si-setup-step" data-step="validate"><div class="si-step-icon">1</div><div class="si-step-text">验证API Token和仓库<div class="si-step-sub">检查Token有效性和仓库可访问性</div></div></div>
                        <div class="si-setup-step" data-step="start"><div class="si-step-icon">2</div><div class="si-step-text">启动云开发环境<div class="si-step-sub">创建并启动CNB Workspace</div></div></div>
                        <div class="si-setup-step" data-step="wait"><div class="si-step-icon">3</div><div class="si-step-text">等待环境就绪<div class="si-step-sub">监控构建和服务启动状态</div></div></div>
                        <div class="si-setup-step" data-step="tunnel"><div class="si-step-icon">4</div><div class="si-step-text">建立SSH隧道<div class="si-step-sub">创建本地端口转发获取访问地址</div></div></div>
                        <div class="si-setup-step" data-step="sync"><div class="si-step-icon">5</div><div class="si-step-text">同步ComfyUI URL<div class="si-step-sub">提取访问地址并填入图像生成模块</div></div></div>
                        <div class="si-setup-step" data-step="test"><div class="si-step-icon">6</div><div class="si-step-text">连接测试<div class="si-step-sub">验证ComfyUI服务可用性和响应状态</div></div></div>
                    </div>
                    <div id="si_cnb_log"></div>
                    <button id="si_cnb_retry" class="si-retry-btn">🔄 重试</button>
                </div>
            </div>

            <h4>🧠 提示词策略</h4>
            <label style="display:block; margin: 4px 0;">
                扩展方式:
                <select id="si_expansion_method" style="width: 100%; margin-top: 2px;">
                    <option value="direct" ${settings.expansionMethod === 'direct' ? 'selected' : ''}>🇨🇳 中文直通 (不翻译)</option>
                    <option value="ollama" ${settings.expansionMethod === 'ollama' ? 'selected' : ''}>🦙 Ollama翻译 (本地模型)</option>
                    <option value="remote_api" ${settings.expansionMethod === 'remote_api' ? 'selected' : ''}>☁️ 远程API翻译 (云端模型)</option>
                    <option value="st_llm" ${settings.expansionMethod === 'st_llm' ? 'selected' : ''}>🇬🇧 ST LLM翻译</option>
                </select>
            </label>
            <div style="margin: 4px 0; padding: 6px; background: rgba(${isDirectMode ? '255,200,0,0.15' : '0,200,100,0.15'}); border-radius: 4px; font-size: 11px; color: ${isDirectMode ? '#ffc800' : '#00c864'};">
                ${isDirectMode ? '中文直通模式 — 中文描述直接作为提示词，不经过翻译' : isRemoteApiMode ? '远程API模式 — 通过云端AI服务翻译为英文Danbooru标签' : isOllamaMode ? 'Ollama模式 — 通过本地Ollama翻译为英文Danbooru标签' : '英文翻译模式 — 中文描述经LLM翻译为英文Danbooru标签'}
            </div>

            <div id="si_ollama_config" style="display: ${isOllamaMode ? 'block' : 'none'}; margin: 6px 0; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(71,85,105,0.3); border-radius: 6px;">
                <div style="font-size: 11px; color: #7dd3fc; margin-bottom: 6px; font-weight: bold;">🦙 Ollama 本地配置</div>
                <label style="display:block; margin: 4px 0;">
                    Ollama URL:
                    <input type="text" id="si_ollama_url" value="${settings.ollamaUrl || 'http://localhost:11434'}" style="margin-top: 2px;">
                </label>
                <label style="display:block; margin: 4px 0;">
                    Ollama 模型:
                    <div style="display: flex; gap: 4px; margin-top: 2px;">
                        <select id="si_ollama_model" style="flex: 1;">
                            ${modelOptionsHtml}
                        </select>
                        <button id="si_refresh_models" class="si-action-btn si-action-icon-only si-action-refresh" title="刷新模型列表"><span class="si-action-icon">🔄</span></button>
                    </div>
                </label>
                <button id="si_test_ollama" class="si-action-btn si-action-test"><span class="si-action-icon">🔌</span><span class="si-action-text">测试Ollama连接</span></button>
            </div>

            <div id="si_remote_api_config" style="display: ${isRemoteApiMode ? 'block' : 'none'}; margin: 6px 0; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(71,85,105,0.3); border-radius: 6px;">
                <div style="font-size: 11px; color: #c084fc; margin-bottom: 6px; font-weight: bold;">☁️ 远程API配置</div>
                <label style="display:block; margin: 4px 0;">
                    API服务商:
                    <select id="si_remote_api_preset" style="width: 100%; margin-top: 2px;">
                        ${REMOTE_API_PRESETS.map(p => `<option value="${p.key}" ${settings.remoteApiFormat === p.key ? 'selected' : ''}>${p.label}</option>`).join('')}
                    </select>
                </label>
                <label style="display:block; margin: 4px 0;">
                    API地址:
                    <input type="text" id="si_remote_api_url" value="${settings.remoteApiUrl || ''}" placeholder="https://api.openai.com/v1" style="margin-top: 2px;">
                </label>
                <label style="display:block; margin: 4px 0;">
                    API密钥:
                    <div style="display: flex; gap: 4px; margin-top: 2px;">
                        <input type="password" id="si_remote_api_key" value="${escapeHtml(settings.remoteApiKey || '')}" placeholder="sk-..." style="flex: 1;">
                        <button id="si_toggle_api_key" class="si-action-btn si-action-icon-only" title="显示/隐藏密钥"><span class="si-action-icon">👁️</span></button>
                    </div>
                    <div style="font-size: 10px; color: #666; margin-top: 2px;">密钥仅存储在本地浏览器中，不会上传至任何第三方服务器</div>
                </label>
                <label style="display:block; margin: 4px 0;">
                    模型:
                    <div style="display: flex; gap: 4px; margin-top: 2px;">
                        <select id="si_remote_api_model" style="flex: 1;">
                            ${remoteModelOptionsHtml}
                        </select>
                        <button id="si_refresh_remote_models" class="si-action-btn si-action-icon-only si-action-refresh" title="刷新远程模型列表"><span class="si-action-icon">🔄</span></button>
                    </div>
                    <input type="text" id="si_remote_api_model_manual" value="${settings.remoteApiModel || ''}" placeholder="手动输入模型名称" style="margin-top: 2px; display: ${remoteApiModels.length > 0 || currentPreset.models.length > 0 ? 'none' : 'block'};">
                </label>
                <label style="display:block; margin: 4px 0;">
                    请求超时:
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                        <input type="range" id="si_remote_api_timeout" min="10" max="120" value="${settings.remoteApiTimeout || 30}" style="flex: 1;">
                        <span id="si_timeout_display" style="font-size: 11px; color: #94a3b8; min-width: 30px;">${settings.remoteApiTimeout || 30}秒</span>
                    </div>
                </label>
                <div style="display: flex; gap: 6px; margin-top: 6px;">
                    <button id="si_test_remote_api" class="si-action-btn si-action-test"><span class="si-action-icon">🔌</span><span class="si-action-text">测试远程API连接</span></button>
                </div>
                <div id="si_remote_api_status" style="margin-top: 6px; display: none;"></div>
            </div>

            <h4>📊 质量评估</h4>
            <label><input type="checkbox" id="si_quality" ${settings.qualityAssessment ? 'checked' : ''}> 启用质量评估</label>
            <label><input type="checkbox" id="si_auto_retry" ${settings.autoRetryOnLowQuality ? 'checked' : ''}> 低质量时自动重试</label>
            <label><input type="checkbox" id="si_model_check" ${settings.modelCheckEnabled ? 'checked' : ''}> 启用模型兼容性检查</label>

            <h4>🎭 角色头像生成</h4>
            <div style="margin: 4px 0; padding: 6px; background: rgba(74,158,255,0.1); border-radius: 4px; font-size: 11px; color: #4a9eff;">
                自动提取角色卡信息，生成匹配角色特征的头像并一键替换
            </div>
            <button id="si_generate_avatar" class="si-action-btn" style="width:100%;padding:10px;font-size:14px;background:linear-gradient(135deg,#4a9eff,#00c864);color:#fff;border:none;border-radius:6px;cursor:pointer;margin:6px 0;">
                <span style="font-size:16px;">🎭</span> 为当前角色生成头像
            </button>
            <div id="si_avatar_ai_status" style="font-size:10px;color:#4a9eff;margin:2px 0;"></div>
            <div id="si_avatar_status" style="font-size:11px;color:#888;margin:4px 0;"></div>
            <div style="margin-top: 6px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; color: #aaa;">
                生成记录: ${logCount} 条 | 最近质量: ${lastQuality} | 最近模式: ${lastMethod} | 最近风格: ${lastStyle}<br>
                ${isDirectMode ? '中文评估: 主体、动作、衣着、表情、视角、环境、光线' : '英文评估: subject, action, clothing, expression, camera, setting, lighting'}
            </div>

            <h4>🔍 模型兼容性</h4>
            <div id="si_model_status" style="margin: 4px 0; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px;"></div>

            <h4>📦 数据导出/导入</h4>
            <div style="margin: 6px 0; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(71,85,105,0.3); border-radius: 6px;">
                <div style="font-size: 11px; color: #fbbf24; margin-bottom: 6px; font-weight: bold;">🗃️ 角色卡与世界书导出</div>
                <div style="font-size: 10px; color: #888; margin-bottom: 6px;">导出为ZIP包，内含SillyTavern原生兼容的V2角色卡JSON和世界书JSON，可直接通过ST导入功能恢复</div>
                <div style="display: flex; gap: 6px; margin-bottom: 6px;">
                    <button id="si_load_chars" class="si-action-btn si-action-refresh"><span class="si-action-icon">📋</span><span class="si-action-text">加载列表</span></button>
                    <button id="si_select_all_export" class="si-action-btn" style="color:#94a3b8;" disabled><span class="si-action-icon">✅</span><span class="si-action-text">全选</span></button>
                    <button id="si_deselect_all_export" class="si-action-btn" style="color:#94a3b8;" disabled><span class="si-action-icon">❌</span><span class="si-action-text">取消全选</span></button>
                </div>
                <div id="si_export_list" style="max-height: 200px; overflow-y: auto; margin: 4px 0; padding: 4px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; display: none;"></div>
                <div style="display: flex; gap: 6px; margin-top: 6px;">
                    <button id="si_export_selected" class="si-action-btn si-action-test" disabled><span class="si-action-icon">💾</span><span class="si-action-text">导出选中项</span></button>
                    <span id="si_export_count" style="font-size: 11px; color: #888; align-self: center;"></span>
                </div>
                <div id="si_export_progress" style="margin-top: 6px; display: none;">
                    <div style="background: rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden; height: 16px;">
                        <div id="si_export_progress_bar" style="height: 100%; background: linear-gradient(90deg, #4a9eff, #7dd3fc); width: 0%; transition: width 0.3s ease; border-radius: 4px;"></div>
                    </div>
                    <div id="si_export_progress_text" style="font-size: 10px; color: #94a3b8; margin-top: 2px;"></div>
                </div>
            </div>

            <div style="margin: 6px 0; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(71,85,105,0.3); border-radius: 6px;">
                <div style="font-size: 11px; color: #34d399; margin-bottom: 6px; font-weight: bold;">⚙️ SillyTavern完整备份</div>
                <div style="font-size: 10px; color: #888; margin-bottom: 6px;">一键导出所有设置、角色卡、世界书、聊天记录为ZIP包，可用于完整迁移到其他设备</div>
                <button id="si_export_full" class="si-action-btn" style="color:#34d399; border-color: rgba(52,211,153,0.3);"><span class="si-action-icon">🔄</span><span class="si-action-text">一键完整导出</span></button>
                <div id="si_full_export_progress" style="margin-top: 6px; display: none;">
                    <div style="background: rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden; height: 16px;">
                        <div id="si_full_export_progress_bar" style="height: 100%; background: linear-gradient(90deg, #34d399, #6ee7b7); width: 0%; transition: width 0.3s ease; border-radius: 4px;"></div>
                    </div>
                    <div id="si_full_export_progress_text" style="font-size: 10px; color: #94a3b8; margin-top: 2px;"></div>
                </div>
            </div>

            <div style="margin: 6px 0; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(71,85,105,0.3); border-radius: 6px;">
                <div style="font-size: 11px; color: #c084fc; margin-bottom: 6px; font-weight: bold;">📥 从ZIP导入</div>
                <div style="font-size: 10px; color: #888; margin-bottom: 6px;">从本扩展导出的ZIP包中批量导入角色卡和世界书（自动调用SillyTavern原生导入API）</div>
                <input type="file" id="si_import_zip_input" accept=".zip" style="display: none;">
                <button id="si_import_zip_btn" class="si-action-btn" style="color:#c084fc; border-color: rgba(192,132,252,0.3);"><span class="si-action-icon">📥</span><span class="si-action-text">选择ZIP文件导入</span></button>
                <div id="si_import_progress" style="margin-top: 6px; display: none;">
                    <div style="background: rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden; height: 16px;">
                        <div id="si_import_progress_bar" style="height: 100%; background: linear-gradient(90deg, #c084fc, #e879f9); width: 0%; transition: width 0.3s ease; border-radius: 4px;"></div>
                    </div>
                    <div id="si_import_progress_text" style="font-size: 10px; color: #94a3b8; margin-top: 2px;"></div>
                </div>
            </div>

            <div style="margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 11px; color: #aaa;">
                <strong>v12更新：</strong><br>✓ 🎨 风格-模型智能匹配 — 自动推荐最佳模型(Animagine XL 3.1/Juggernaut XL v9)<br>✓ 🔄 自动模型切换 — 选择风格时自动切换至推荐模型<br>✓ 📋 优化提示词模板 — 每种风格×模型组合独立优化<br>✓ 🎬 新增风格 — 电影感/奇幻/人物肖像<br>✓ 📐 智能尺寸 — 根据模型和风格自动推荐最佳分辨率<br>✓ 💡 模型提示 — 实时显示当前模型与推荐模型的匹配状态<br>
                ✓ ☁️ CNB自动唤醒 — 检测ComfyUI服务状态，离线时自动唤醒<br>
                ✓ 🔄 保持活跃 — 定期ping防止CNB服务休眠<br>
                ✓ 📊 状态监控 — 实时显示ComfyUI运行状态及连接情况<br>
                ✓ ⚙️ 可配置选项 — 自定义唤醒超时、轮询间隔、保活策略<br>
                ✓ 📦 导出格式升级 — 角色卡使用V2 Spec标准，世界书使用ST原生格式，可直接导入<br>
                ✓ 📥 ZIP导入功能 — 从导出的ZIP包批量导入角色卡和世界书<br>
                ✓ 💾 完整备份增强 — 包含聊天记录，ZIP格式便于迁移<br>
                ✓ ☁️ 远程API模式 — 支持OpenAI/DeepSeek/通义千问/智谱/Moonshot等云端AI服务<br>
                ✓ 🔑 API密钥安全 — 密钥仅本地存储，传输使用HTTPS加密<br>
                ✓ 🛡️ 错误恢复 — 网络异常/认证失败/超时自动降级到ST LLM
            </div>
        </div>
    `;

    document.getElementById('si_enabled')?.addEventListener('change', function () {
        settings.enabled = !!this.checked; saveSettingsDebounced();
        scanAllVisibleMessages();
    });
    document.getElementById('si_auto_tags')?.addEventListener('change', function () {
        settings.autoProcessTags = !!this.checked; saveSettingsDebounced();
        loadSettingsUI();
        scanAllVisibleMessages();
    });
    document.getElementById('si_remove_tag')?.addEventListener('change', function () {
        settings.removeTagAfterProcess = !!this.checked; saveSettingsDebounced();
    });
    document.getElementById('si_show_toasts')?.addEventListener('change', function () {
        settings.showToasts = !!this.checked; saveSettingsDebounced();
    });

    document.querySelectorAll('.si-style-card').forEach(card => {
        card.addEventListener('click', async function () {
            const styleKey = this.dataset.style;
            if (styleKey && STYLE_CONFIGS[styleKey]) {
                settings.style = styleKey;
                saveSettingsDebounced();

                if (extension_settings.sd?.source === 'comfy') {
                    await autoSwitchModel(styleKey);
                }

                applyStyleToSdConfig(styleKey);
                loadSettingsUI();

                const styleConfig = getStyleConfig();
                const modelInfo = getModelMatchInfo(styleKey);
                const matchIcon = modelInfo.isOptimal ? '✅' : '⚠️';
                showToast(`${STYLE_CONFIGS[styleKey].icon} ${STYLE_CONFIGS[styleKey].label} | ${matchIcon} ${modelInfo.currentModelName} | CFG=${styleConfig.scale} Steps=${styleConfig.steps}`, 'success');
            }
        });
        card.addEventListener('mouseenter', function () {
            if (!this.classList.contains('si-style-active')) {
                this.style.borderColor = '#666';
                this.style.background = 'rgba(255,255,255,0.05)';
            }
        });
        card.addEventListener('mouseleave', function () {
            if (!this.classList.contains('si-style-active')) {
                this.style.borderColor = '#444';
                this.style.background = 'rgba(0,0,0,0.2)';
            }
        });
    });

    document.getElementById('si_sync_style_to_sd')?.addEventListener('click', async function () {
        const btn = this;
        const statusEl = document.getElementById('si_sync_style_status');
        const sd = extension_settings.sd;

        if (!sd) {
            showToast('SD扩展未加载，无法同步风格参数', 'error');
            if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#ff5050'; statusEl.textContent = '❌ SD扩展未加载，请确认Image Generation扩展已启用'; }
            return;
        }

        const iconEl = btn.querySelector('.si-action-icon');
        const textEl = btn.querySelector('.si-action-text');
        const origIcon = iconEl?.textContent || '🔄';
        const origText = textEl?.textContent || '同步风格到SD扩展';

        iconEl && (iconEl.textContent = '⏳');
        textEl && (textEl.textContent = '同步中...');
        btn.disabled = true;
        btn.style.opacity = '0.7';
        if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#4a9eff'; statusEl.textContent = '⏳ 正在同步风格参数到SD扩展...'; }

        try {
            const styleConfig = getStyleConfig();
            const currentSettings = getSettings();
            const changes = [];
            let sourceChanged = false;

            if (currentSettings.cnbEnabled && sd.source !== 'comfy') {
                sd.source = 'comfy';
                $('#sd_source').val('comfy').trigger('change');
                sourceChanged = true;
                changes.push('Source=ComfyUI');
            }

            if (sd.comfy_url && $('#comfy_url').val() !== sd.comfy_url) {
                $('#comfy_url').val(sd.comfy_url).trigger('input');
                changes.push('ComfyUI URL');
            }

            if (styleConfig.scale !== undefined && sd.scale !== styleConfig.scale) {
                sd.scale = styleConfig.scale;
                $('#sd_scale').val(styleConfig.scale).trigger('input');
                changes.push(`CFG=${styleConfig.scale}`);
            }

            if (styleConfig.steps !== undefined && sd.steps !== styleConfig.steps) {
                sd.steps = styleConfig.steps;
                $('#sd_steps').val(styleConfig.steps).trigger('input');
                changes.push(`Steps=${styleConfig.steps}`);
            }

            if (styleConfig.sampler && sd.sampler !== styleConfig.sampler) {
                sd.sampler = styleConfig.sampler;
                $('#sd_sampler').val(styleConfig.sampler).trigger('change');
                changes.push(`Sampler=${styleConfig.sampler}`);
            }

            if (styleConfig.scheduler && sd.scheduler !== styleConfig.scheduler) {
                sd.scheduler = styleConfig.scheduler;
                $('#sd_scheduler').val(styleConfig.scheduler).trigger('change');
                changes.push(`Scheduler=${styleConfig.scheduler}`);
            }

            if (styleConfig.size) {
                const [w, h] = styleConfig.size.split('x').map(Number);
                if (w && h && (sd.width !== w || sd.height !== h)) {
                    sd.width = w;
                    sd.height = h;
                    $('#sd_width').val(w).trigger('input');
                    $('#sd_height').val(h).trigger('input');
                    changes.push(`Size=${styleConfig.size}`);
                }
            }

            if (styleConfig.promptPrefix && sd.prompt_prefix !== styleConfig.promptPrefix) {
                sd.prompt_prefix = styleConfig.promptPrefix;
                $('#sd_prompt_prefix').val(styleConfig.promptPrefix).trigger('input');
                changes.push('正向前缀');
            }

            if (styleConfig.negativeExtra) {
                const newNeg = [sd.negative_prompt, styleConfig.negativeExtra].filter(Boolean).join(', ');
                if (sd.negative_prompt !== newNeg) {
                    sd.negative_prompt = newNeg;
                    $('#sd_negative_prompt').val(newNeg).trigger('input');
                    changes.push('反向提示词');
                }
            }

            if (currentSettings.comfyWorkflow && sd.comfy_workflow !== currentSettings.comfyWorkflow) {
                sd.comfy_workflow = currentSettings.comfyWorkflow;
                $('#sd_comfy_workflow').val(currentSettings.comfyWorkflow).trigger('change');
                changes.push('工作流');
            }

            if (styleConfig.model && sd.model !== styleConfig.model) {
                sd.model = styleConfig.model;
                $('#sd_model').val(styleConfig.model).trigger('change');
                changes.push(`Model=${styleConfig.model}`);
            }

            if (styleConfig.vae && sd.vae !== styleConfig.vae) {
                sd.vae = styleConfig.vae;
                $('#sd_vae').val(styleConfig.vae).trigger('change');
                changes.push(`VAE=${styleConfig.vae}`);
            }

            if (styleConfig.clipSkip !== undefined && sd.clip_skip !== styleConfig.clipSkip) {
                sd.clip_skip = styleConfig.clipSkip;
                $('#sd_clip_skip').val(styleConfig.clipSkip).trigger('input');
                changes.push(`CLIP Skip=${styleConfig.clipSkip}`);
            }

            if (typeof toggleSourceControls === 'function' && sourceChanged) {
                toggleSourceControls();
            }

            saveSettingsDebounced();

            await new Promise(r => setTimeout(r, 300));

            if (changes.length > 0) {
                iconEl && (iconEl.textContent = '✅');
                textEl && (textEl.textContent = '同步成功');
                if (statusEl) { statusEl.style.color = '#00c864'; statusEl.textContent = `✅ 已同步 ${changes.length} 项参数: ${changes.join(', ')}`; }
                showToast(`🎨 风格参数已同步: ${changes.join(', ')}`, 'success');
            } else {
                iconEl && (iconEl.textContent = '✅');
                textEl && (textEl.textContent = '已同步');
                if (statusEl) { statusEl.style.color = '#00c864'; statusEl.textContent = '✅ 所有参数已是最新，无需更新'; }
                showToast('🎨 风格参数已是最新状态', 'info');
            }
        } catch (err) {
            console.error('[Story-Images] Style sync error:', err);
            iconEl && (iconEl.textContent = '❌');
            textEl && (textEl.textContent = '同步失败');
            if (statusEl) { statusEl.style.color = '#ff5050'; statusEl.textContent = `❌ 同步失败: ${err.message}`; }
            showToast(`风格同步失败: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.style.opacity = '1';
            setTimeout(() => {
                iconEl && (iconEl.textContent = origIcon);
                textEl && (textEl.textContent = origText);
                if (statusEl) { setTimeout(() => { statusEl.style.display = 'none'; }, 3000); }
            }, 2000);
        }
    });

    document.getElementById('si_comfy_workflow')?.addEventListener('change', function () {
        settings.comfyWorkflow = this.value;
        if (this.value && extension_settings.sd) {
            extension_settings.sd.comfy_workflow = this.value;
        }
        saveSettingsDebounced();
        updateWorkflowInfo(this.value);
        showToast(this.value ? `工作流已切换: ${this.value}` : '使用SD扩展默认工作流', 'success');
    });

    document.getElementById('si_refresh_workflows')?.addEventListener('click', async function () {
        showToast('正在刷新工作流列表...', 'info');
        await fetchComfyWorkflows();
        loadSettingsUI();
    });

    document.getElementById('si_cnb_enabled')?.addEventListener('change', function () {
        settings.cnbEnabled = !!this.checked;
        saveSettingsDebounced();
        if (settings.cnbEnabled) {
            cnbStartStatusPolling();
            if (settings.cnbKeepAlive) {
                cnbStartKeepAlive();
            }
        } else {
            cnbStopStatusPolling();
            cnbStopKeepAlive();
            cnbClearAutoStopTimer();
        }
        loadSettingsUI();
    });

    document.getElementById('si_cnb_api_token')?.addEventListener('change', function () {
        settings.cnbApiToken = this.value.trim();
        saveSettingsDebounced();
        showToast('CNB API Token已更新', 'success');
        if (settings.cnbApiToken) {
            cnbFetchRepos();
        }
    });

    document.getElementById('si_cnb_repo_select')?.addEventListener('change', function () {
        if (this.value === '__custom__') {
            const textInput = document.getElementById('si_cnb_repo_path');
            if (textInput) {
                textInput.style.display = 'block';
                textInput.focus();
            }
            settings.cnbRepoPath = '';
            saveSettingsDebounced();
            return;
        }

        const textInput = document.getElementById('si_cnb_repo_path');
        if (textInput) textInput.style.display = 'none';

        settings.cnbRepoPath = this.value;
        saveSettingsDebounced();

        if (this.value) {
            const selectedOption = this.options[this.selectedIndex];
            const defaultBranch = selectedOption?.dataset?.defaultBranch;
            if (defaultBranch && !settings.cnbBranch) {
                settings.cnbBranch = defaultBranch;
                saveSettingsDebounced();
            }
            cnbFetchBranches(this.value);
            showToast(`✅ 已选择仓库: ${this.value}`, 'success');
        }
    });

    document.getElementById('si_cnb_repo_path')?.addEventListener('change', async function () {
        const rawValue = this.value.trim();
        
        if (/:/.test(rawValue)) {
            showToast('⚠️ 仓库路径包含冒号，请确认输入的是仓库路径而非描述文字。正确格式: 组织名/仓库名', 'error');
            this.style.borderColor = '#ff5050';
            return;
        }
        
        if (/[^\x00-\x7F]/.test(rawValue)) {
            showToast('⚠️ 仓库路径包含非ASCII字符（中文等），请确认路径是否正确。CNB仓库路径通常只包含英文、数字和连字符', 'error');
            this.style.borderColor = '#ffc800';
        } else {
            this.style.borderColor = '';
        }
        
        if (!rawValue.includes('/')) {
            showToast('⚠️ 仓库路径格式错误，应为: 组织名/仓库名（如 my-org/comfyui）', 'error');
            this.style.borderColor = '#ff5050';
            return;
        }

        settings.cnbRepoPath = rawValue;
        saveSettingsDebounced();
        
        if (settings.cnbApiToken && rawValue) {
            try {
                const result = await cnbApiCall(`/validate-repo?repo=${encodeURIComponent(rawValue)}`);
                if (result.valid && result.exists) {
                    showToast(`✅ 仓库验证通过: ${result.path}`, 'success');
                    this.style.borderColor = '#00c864';
                    if (result.defaultBranch) {
                        settings.cnbBranch = result.defaultBranch;
                        const branchSelect = document.getElementById('si_cnb_branch_select');
                        if (branchSelect) branchSelect.value = result.defaultBranch;
                        saveSettingsDebounced();
                    }
                    cnbFetchBranches(rawValue);
                } else if (result.valid && !result.exists) {
                    showToast(`⚠️ ${result.error}`, 'error');
                    this.style.borderColor = '#ff5050';
                } else {
                    showToast(`⚠️ ${result.error}`, 'error');
                    this.style.borderColor = '#ff5050';
                }
            } catch (e) {
                showToast('仓库路径已更新', 'success');
                cnbFetchBranches(rawValue);
            }
        } else {
            showToast('仓库路径已更新', 'success');
        }
    });

    document.getElementById('si_cnb_branch_select')?.addEventListener('change', function () {
        if (this.value === '__custom__') {
            const textInput = document.getElementById('si_cnb_branch');
            if (textInput) {
                textInput.style.display = 'block';
                textInput.focus();
            }
            settings.cnbBranch = '';
            saveSettingsDebounced();
            return;
        }

        const textInput = document.getElementById('si_cnb_branch');
        if (textInput) textInput.style.display = 'none';

        settings.cnbBranch = this.value;
        saveSettingsDebounced();
        showToast(`✅ 已选择分支: ${this.value}`, 'success');
    });

    document.getElementById('si_cnb_branch')?.addEventListener('change', function () {
        settings.cnbBranch = this.value.trim() || 'main';
        saveSettingsDebounced();
    });

    document.getElementById('si_cnb_test_token')?.addEventListener('click', async function () {
        this.disabled = true;
        await cnbTestApiToken();
        this.disabled = false;
    });

    document.getElementById('si_cnb_auto_wake')?.addEventListener('change', function () {
        settings.cnbAutoWake = !!this.checked;
        saveSettingsDebounced();
    });

    document.getElementById('si_cnb_wake_timeout')?.addEventListener('input', function () {
        const display = document.getElementById('si_cnb_wake_timeout_display');
        if (display) display.textContent = `${this.value}秒`;
    });
    document.getElementById('si_cnb_wake_timeout')?.addEventListener('change', function () {
        settings.cnbWakeTimeout = parseInt(this.value) || 120;
        saveSettingsDebounced();
    });

    document.getElementById('si_cnb_poll_interval')?.addEventListener('input', function () {
        const display = document.getElementById('si_cnb_poll_interval_display');
        if (display) display.textContent = `${this.value}秒`;
    });
    document.getElementById('si_cnb_poll_interval')?.addEventListener('change', function () {
        settings.cnbPollInterval = parseInt(this.value) || 5;
        saveSettingsDebounced();
    });

    document.getElementById('si_cnb_keep_alive')?.addEventListener('change', function () {
        settings.cnbKeepAlive = !!this.checked;
        saveSettingsDebounced();
        const keepAliveConfig = document.getElementById('si_cnb_keep_alive_config');
        if (keepAliveConfig) keepAliveConfig.style.display = settings.cnbKeepAlive ? 'block' : 'none';
        if (settings.cnbKeepAlive && settings.cnbEnabled) {
            cnbStartKeepAlive();
        } else {
            cnbStopKeepAlive();
        }
    });

    document.getElementById('si_cnb_keep_alive_interval')?.addEventListener('input', function () {
        const display = document.getElementById('si_cnb_keep_alive_interval_display');
        if (display) display.textContent = `${this.value}秒`;
    });
    document.getElementById('si_cnb_keep_alive_interval')?.addEventListener('change', function () {
        settings.cnbKeepAliveInterval = parseInt(this.value) || 300;
        saveSettingsDebounced();
        if (settings.cnbKeepAlive && settings.cnbEnabled) {
            cnbStartKeepAlive();
        }
    });

    document.getElementById('si_cnb_auto_stop')?.addEventListener('change', function () {
        settings.cnbAutoStop = !!this.checked;
        saveSettingsDebounced();
        const autoStopConfig = document.getElementById('si_cnb_auto_stop_config');
        if (autoStopConfig) autoStopConfig.style.display = settings.cnbAutoStop ? 'block' : 'none';
        if (settings.cnbAutoStop && settings.cnbEnabled) {
            cnbResetAutoStopTimer();
        } else {
            cnbClearAutoStopTimer();
        }
    });

    document.getElementById('si_cnb_auto_stop_delay')?.addEventListener('input', function () {
        const display = document.getElementById('si_cnb_auto_stop_delay_display');
        if (display) display.textContent = `${this.value}分钟`;
    });
    document.getElementById('si_cnb_auto_stop_delay')?.addEventListener('change', function () {
        settings.cnbAutoStopDelay = parseInt(this.value) || 30;
        saveSettingsDebounced();
        if (settings.cnbAutoStop && settings.cnbEnabled) {
            cnbResetAutoStopTimer();
        }
    });

    document.getElementById('si_cnb_start_service')?.addEventListener('click', async function () {
        const settings = getSettings();
        if (!settings.cnbApiToken) {
            showToast('请先配置CNB API Token和仓库路径', 'error');
            return;
        }
        await cnbAutoSetup();
    });

    document.getElementById('si_cnb_retry')?.addEventListener('click', async function () {
        const retryStep = cnbSetupState.failedStep || 'validate';
        await cnbAutoSetup(retryStep);
    });

    document.getElementById('si_cnb_stop_service')?.addEventListener('click', async function () {
        this.disabled = true;
        await cnbStopService();
        this.disabled = false;
    });

    document.getElementById('si_cnb_check_status')?.addEventListener('click', async function () {
        if (this.disabled) return;
        this.disabled = true;
        const checkBtn = this;
        const origText = checkBtn.querySelector('.si-action-text')?.textContent || '';
        const textEl = checkBtn.querySelector('.si-action-text');
        if (textEl) textEl.textContent = '检测中...';

        cnbUpdateStatusUI('checking', '正在检测服务状态...', {
            progress: 10,
            stageLabel: '初始化检测',
        });

        const settings = getSettings();
        const comfyUrl = extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188';
        let wsDetail = null;
        let comfyOnline = false;
        let checkError = null;

        const checkTimeout = setTimeout(() => {
            cnbUpdateStatusUI('offline', '检测超时', {
                progress: 0,
                stageLabel: '超时',
                detail: { error: '检测操作超时(30秒)，请检查网络连接和服务器状态' },
            });
            showToast('⚠️ 检测超时，请检查SillyTavern服务器是否正常运行', 'error');
            if (textEl) textEl.textContent = origText;
            checkBtn.disabled = false;
        }, 30000);

        try {
            if (settings.cnbApiToken && settings.cnbRepoPath) {
                cnbUpdateStatusUI('checking', '正在查询CNB工作空间状态...', {
                    progress: 30,
                    stageLabel: '查询工作空间',
                });

                try {
                    const wsStatus = await cnbCheckWorkspaceStatus();
                    if (wsStatus.running && wsStatus.workspace) {
                        cnbServiceState.workspaceSn = wsStatus.workspace.sn;
                        cnbServiceState.pipelineId = wsStatus.workspace.pipelineId;
                        wsDetail = {
                            workspaceSn: wsStatus.workspace.sn,
                            branch: wsStatus.workspace.branch,
                            duration: wsStatus.workspace.duration,
                            comfyUrl: wsStatus.comfyProxyUrl || wsStatus.localTunnelUrl || '',
                        };
                    } else if (wsStatus.error) {
                        wsDetail = { error: `CNB API查询失败: ${wsStatus.error}` };
                    } else if (wsStatus.running === false) {
                        wsDetail = { error: '没有运行中的工作空间，请点击一键启动' };
                    } else {
                        wsDetail = { error: '无法获取工作空间状态' };
                    }
                } catch (e) {
                    wsDetail = { error: `CNB API错误: ${e.message}` };
                    console.warn('[Story-Images CNB] Workspace check failed:', e.message);
                }
            } else {
                wsDetail = { error: 'CNB API Token或仓库路径未配置' };
            }

            cnbUpdateStatusUI('checking', '正在检测ComfyUI服务...', {
                progress: 70,
                stageLabel: '检测ComfyUI',
                detail: wsDetail,
            });

            try {
                const status = await cnbCheckComfyStatus(comfyUrl);
                comfyOnline = status.online;
                if (!status.online && status.error) {
                    checkError = status.error;
                }
            } catch (e) {
                comfyOnline = false;
                checkError = e.message;
                console.warn('[Story-Images CNB] ComfyUI check failed:', e.message);
            }

            if (comfyOnline) {
                cnbServiceState.status = 'online';
                cnbServiceState.lastCheck = new Date().toISOString();
                cnbServiceState.consecutiveFailures = 0;

                const comfyDetail = { ...wsDetail };
                comfyDetail.comfyUrl = comfyUrl;
                cnbUpdateStatusUI('online', '服务在线', {
                    progress: 100,
                    stageLabel: '检测完成',
                    detail: comfyDetail,
                });
                showToast('✅ ComfyUI服务在线', 'success');
            } else {
                cnbServiceState.status = 'offline';
                cnbServiceState.lastCheck = new Date().toISOString();

                const offlineDetail = { ...wsDetail };
                offlineDetail.error = offlineDetail.error || `ComfyUI无法连接 (${checkError || '超时'})`;
                cnbUpdateStatusUI('offline', '服务离线', {
                    progress: 0,
                    stageLabel: '检测完成',
                    detail: offlineDetail,
                });
                showToast('❌ ComfyUI服务离线', 'error');
            }
        } catch (e) {
            console.error('[Story-Images CNB] Status check error:', e);
            cnbUpdateStatusUI('offline', '检测失败', {
                progress: 0,
                stageLabel: '检测失败',
                detail: { error: `检测过程出错: ${e.message}` },
            });
            showToast(`⚠️ 检测失败: ${e.message}`, 'error');
        }

        clearTimeout(checkTimeout);
        if (textEl) textEl.textContent = origText;
        this.disabled = false;
    });

    document.getElementById('si_expansion_method')?.addEventListener('change', function () {
        settings.expansionMethod = this.value; saveSettingsDebounced();
        loadSettingsUI();
    });
    document.getElementById('si_ollama_url')?.addEventListener('change', async function () {
        settings.ollamaUrl = this.value.trim(); saveSettingsDebounced();
        await fetchOllamaModels();
        loadSettingsUI();
    });
    document.getElementById('si_ollama_model')?.addEventListener('change', function () {
        settings.ollamaModel = this.value; saveSettingsDebounced();
        showToast(`Ollama模型已切换: ${this.value}`, 'success');
    });
    document.getElementById('si_refresh_models')?.addEventListener('click', async function () {
        showToast('正在获取Ollama模型列表...', 'info');
        await fetchOllamaModels();
        loadSettingsUI();
    });
    document.getElementById('si_quality')?.addEventListener('change', function () {
        settings.qualityAssessment = !!this.checked; saveSettingsDebounced();
    });
    document.getElementById('si_auto_retry')?.addEventListener('change', function () {
        settings.autoRetryOnLowQuality = !!this.checked; saveSettingsDebounced();
    });
    document.getElementById('si_generate_avatar')?.addEventListener('click', async function() {
        this.disabled = true;
        this.innerHTML = '<span style="font-size:16px;">⏳</span> 生成中...';
        const statusEl = document.getElementById('si_avatar_status');
        const aiStatusEl = document.getElementById('si_avatar_ai_status');
        const settings = getSettings();
        const hasRemoteApi = !!(settings.remoteApiUrl && settings.remoteApiKey);
        const hasOllama = !!settings.ollamaUrl;
        const hasStLlm = typeof generateQuietPrompt === 'function';
        let aiMethod = '本地模式匹配';
        if (settings.expansionMethod === 'remote_api' || (settings.expansionMethod === 'direct' && hasRemoteApi)) aiMethod = '远程API (' + (settings.remoteApiModel || 'gpt-4o-mini') + ')';
        else if (settings.expansionMethod === 'ollama' || (settings.expansionMethod === 'direct' && hasOllama)) aiMethod = 'Ollama (' + (settings.ollamaModel || 'qwen2.5:7b') + ')';
        else if (settings.expansionMethod === 'st_llm' || (settings.expansionMethod === 'direct' && hasStLlm)) aiMethod = 'SillyTavern LLM';
        if (aiStatusEl) aiStatusEl.textContent = '🤖 AI分析引擎: ' + aiMethod;
        if (statusEl) statusEl.textContent = '正在提取角色信息 → AI分析故事与人物 → 生成头像...';
        try {
            await generateAvatarImage();
        } catch (e) {
            showToast(`❌ 头像生成失败: ${e.message}`, 'error');
        }
        this.disabled = false;
        this.innerHTML = '<span style="font-size:16px;">🎭</span> 为当前角色生成头像';
        if (statusEl) statusEl.textContent = '';
    });

    document.getElementById('si_model_check')?.addEventListener('change', function () {
        settings.modelCheckEnabled = !!this.checked; saveSettingsDebounced();
        updateModelStatus();
    });
    document.getElementById('si_test_ollama')?.addEventListener('click', async function () {
        await testOllamaConnection();
        await loadSettingsUI();
    });

    document.getElementById('si_remote_api_preset')?.addEventListener('change', function () {
        const preset = REMOTE_API_PRESETS.find(p => p.key === this.value);
        if (preset) {
            settings.remoteApiFormat = this.value;
            if (preset.url) {
                settings.remoteApiUrl = preset.url;
                const urlInput = document.getElementById('si_remote_api_url');
                if (urlInput) urlInput.value = preset.url;
            }
            if (preset.models.length > 0 && !settings.remoteApiModel) {
                settings.remoteApiModel = preset.models[0];
            }
            saveSettingsDebounced();
            loadSettingsUI();
        }
    });

    document.getElementById('si_remote_api_url')?.addEventListener('change', function () {
        settings.remoteApiUrl = this.value.trim();
        saveSettingsDebounced();
        cachedRemoteApiModels = null;
    });

    document.getElementById('si_remote_api_key')?.addEventListener('change', function () {
        settings.remoteApiKey = this.value.trim();
        saveSettingsDebounced();
        cachedRemoteApiModels = null;
        console.log(`[Story-Images] Remote API key updated: ${maskApiKey(settings.remoteApiKey)}`);
    });

    document.getElementById('si_toggle_api_key')?.addEventListener('click', function () {
        const keyInput = document.getElementById('si_remote_api_key');
        if (!keyInput) return;
        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            this.querySelector('.si-action-icon').textContent = '🙈';
        } else {
            keyInput.type = 'password';
            this.querySelector('.si-action-icon').textContent = '👁️';
        }
    });

    document.getElementById('si_remote_api_model')?.addEventListener('change', function () {
        settings.remoteApiModel = this.value;
        saveSettingsDebounced();
        const manualInput = document.getElementById('si_remote_api_model_manual');
        if (manualInput) manualInput.value = this.value;
        showToast(`远程API模型已切换: ${this.value}`, 'success');
    });

    document.getElementById('si_remote_api_model_manual')?.addEventListener('change', function () {
        settings.remoteApiModel = this.value.trim();
        saveSettingsDebounced();
        showToast(`远程API模型已设置: ${this.value.trim()}`, 'success');
    });

    document.getElementById('si_refresh_remote_models')?.addEventListener('click', async function () {
        showToast('正在获取远程API模型列表...', 'info');
        await fetchRemoteApiModels();
        loadSettingsUI();
    });

    document.getElementById('si_remote_api_timeout')?.addEventListener('input', function () {
        const display = document.getElementById('si_timeout_display');
        if (display) display.textContent = `${this.value}秒`;
    });
    document.getElementById('si_remote_api_timeout')?.addEventListener('change', function () {
        settings.remoteApiTimeout = parseInt(this.value) || 30;
        saveSettingsDebounced();
    });

    document.getElementById('si_test_remote_api')?.addEventListener('click', async function () {
        const statusEl = document.getElementById('si_remote_api_status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = '<span style="color: #ffc800;">⏳ 正在测试连接...</span>';
        }
        const success = await testRemoteApiConnection();
        if (statusEl) {
            if (success) {
                const maskedKey = maskApiKey(settings.remoteApiKey);
                statusEl.innerHTML = `<span style="color: #00c864;">✅ 连接成功</span> <span style="color: #888; font-size: 10px;">密钥: ${escapeHtml(maskedKey)}</span>`;
            } else {
                statusEl.innerHTML = '<span style="color: #ff5050;">❌ 连接失败</span>';
            }
        }
        await loadSettingsUI();
    });

    let exportCharList = [];
    let exportWorldList = [];

    document.getElementById('si_load_chars')?.addEventListener('click', async function () {
        this.disabled = true;
        const listEl = document.getElementById('si_export_list');
        if (listEl) {
            listEl.style.display = 'block';
            listEl.innerHTML = '<span style="color: #888;">⏳ 正在加载...</span>';
        }

        exportCharList = await fetchCharacterList();
        exportWorldList = await fetchWorldInfoList();

        let html = '';
        if (exportCharList.length > 0) {
            html += '<div style="color: #7dd3fc; margin: 4px 0; font-weight: bold;">🧑 角色卡</div>';
            for (const char of exportCharList) {
                const name = (char.avatar_url || char.name || '').replace(/\.png$/, '');
                if (!name) continue;
                html += `<label style="display: flex; align-items: center; gap: 4px; margin: 2px 0; cursor: pointer;">
                    <input type="checkbox" class="si-export-check" data-type="char" data-name="${escapeHtml(name)}" checked>
                    <span style="color: #cbd5e1;">${escapeHtml(name)}</span>
                </label>`;
            }
        }
        if (exportWorldList.length > 0) {
            html += '<div style="color: #fbbf24; margin: 8px 0 4px; font-weight: bold;">📖 世界书</div>';
            for (const world of exportWorldList) {
                const name = world.name || world.file_id || '';
                if (!name) continue;
                html += `<label style="display: flex; align-items: center; gap: 4px; margin: 2px 0; cursor: pointer;">
                    <input type="checkbox" class="si-export-check" data-type="world" data-name="${escapeHtml(name)}" checked>
                    <span style="color: #cbd5e1;">${escapeHtml(name)}</span>
                </label>`;
            }
        }
        if (!html) {
            html = '<span style="color: #888;">未找到任何角色卡或世界书</span>';
        }

        listEl.innerHTML = html;
        this.disabled = false;

        document.getElementById('si_select_all_export')?.removeAttribute('disabled');
        document.getElementById('si_deselect_all_export')?.removeAttribute('disabled');
        document.getElementById('si_export_selected')?.removeAttribute('disabled');
        updateExportCount();
    });

    function updateExportCount() {
        const checked = document.querySelectorAll('.si-export-check:checked');
        const countEl = document.getElementById('si_export_count');
        if (countEl) {
            const chars = Array.from(checked).filter(c => c.dataset.type === 'char').length;
            const worlds = Array.from(checked).filter(c => c.dataset.type === 'world').length;
            countEl.textContent = `已选: ${chars}角色 + ${worlds}世界书`;
        }
    }

    document.getElementById('si_select_all_export')?.addEventListener('click', function () {
        document.querySelectorAll('.si-export-check').forEach(cb => { cb.checked = true; });
        updateExportCount();
    });

    document.getElementById('si_deselect_all_export')?.addEventListener('click', function () {
        document.querySelectorAll('.si-export-check').forEach(cb => { cb.checked = false; });
        updateExportCount();
    });

    document.getElementById('si_export_list')?.addEventListener('change', function (e) {
        if (e.target.classList.contains('si-export-check')) {
            updateExportCount();
        }
    });

    document.getElementById('si_export_selected')?.addEventListener('click', async function () {
        const checked = document.querySelectorAll('.si-export-check:checked');
        if (checked.length === 0) {
            toastr.error('请至少选择一个导出项', '图片功能辅助');
            return;
        }

        const selectedChars = Array.from(checked)
            .filter(c => c.dataset.type === 'char')
            .map(c => c.dataset.name);
        const selectedWorlds = Array.from(checked)
            .filter(c => c.dataset.type === 'world')
            .map(c => c.dataset.name);

        const progressEl = document.getElementById('si_export_progress');
        const progressBar = document.getElementById('si_export_progress_bar');
        const progressText = document.getElementById('si_export_progress_text');

        if (progressEl) progressEl.style.display = 'block';
        this.disabled = true;

        try {
            console.log(`[Story-Images] Starting export: ${selectedChars.length} chars, ${selectedWorlds.length} worlds`);
            const result = await exportCharactersAndWorldBooks(selectedChars, selectedWorlds, (done, total, msg) => {
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (progressText) progressText.textContent = `${msg} (${done}/${total})`;
            });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            downloadBlob(result.blob, `story-images-export-${timestamp}.zip`);
            toastr.success(`导出完成! ${result.charCount}个角色 + ${result.worldCount}个世界书`, '图片功能辅助');
        } catch (e) {
            console.error('[Story-Images] Export failed:', e);
            toastr.error(`导出失败: ${e.message}`, '图片功能辅助');
        } finally {
            this.disabled = false;
        }
    });

    document.getElementById('si_export_full')?.addEventListener('click', async function () {
        const progressEl = document.getElementById('si_full_export_progress');
        const progressBar = document.getElementById('si_full_export_progress_bar');
        const progressText = document.getElementById('si_full_export_progress_text');

        if (progressEl) progressEl.style.display = 'block';
        this.disabled = true;

        try {
            console.log('[Story-Images] Starting full backup export');
            const result = await exportFullSettings((done, total, msg) => {
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (progressText) progressText.textContent = `${msg} (${done}/${total})`;
            });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            downloadBlob(result.blob, `sillytavern-full-backup-${timestamp}.zip`);
            toastr.success(`完整备份导出完成! ${result.charCount}个角色 + ${result.worldCount}个世界书 + ${result.chatCount}个聊天记录`, '图片功能辅助');
        } catch (e) {
            console.error('[Story-Images] Full backup failed:', e);
            toastr.error(`完整备份失败: ${e.message}`, '图片功能辅助');
        } finally {
            this.disabled = false;
        }
    });

    document.getElementById('si_import_zip_btn')?.addEventListener('click', function () {
        document.getElementById('si_import_zip_input')?.click();
    });

    document.getElementById('si_import_zip_input')?.addEventListener('change', async function () {
        const file = this.files?.[0];
        if (!file) return;

        const progressEl = document.getElementById('si_import_progress');
        const progressBar = document.getElementById('si_import_progress_bar');
        const progressText = document.getElementById('si_import_progress_text');

        if (progressEl) progressEl.style.display = 'block';
        const btn = document.getElementById('si_import_zip_btn');
        if (btn) btn.disabled = true;

        try {
            const result = await importFromZip(file, (done, total, msg) => {
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (progressText) progressText.textContent = `${msg} (${done}/${total})`;
            });

            let msg = `导入完成! ${result.importedChars}/${result.totalChars}个角色 + ${result.importedWorlds}/${result.totalWorlds}个世界书`;
            if (result.errors.length > 0) {
                msg += ` | ${result.errors.length}个错误`;
                console.warn('[Story-Images] Import errors:', result.errors);
            }
            if (result.hasSettings) {
                msg += ' | 包含settings.json（需手动恢复）';
            }
            if (result.errors.length > 0) {
                toastr.warning(msg, '图片功能辅助');
            } else {
                toastr.success(msg, '图片功能辅助');
            }
        } catch (e) {
            console.error('[Story-Images] Import failed:', e);
            toastr.error(`导入失败: ${e.message}`, '图片功能辅助');
        } finally {
            if (btn) btn.disabled = false;
            this.value = '';
        }
    });

    updateWorkflowInfo(settings.comfyWorkflow);
    updateModelStatus();
}

function updateModelStatus() {
    const statusEl = document.getElementById('si_model_status');
    if (!statusEl) return;

    const sd = extension_settings.sd;
    if (!sd) {
        statusEl.innerHTML = '<span style="color: #888;">SD扩展未加载</span>';
        return;
    }

    const model = sd.model || '未选择';
    const source = sd.source || '未配置';
    const compat = checkModelCompatibility();

    let html = `<div style="margin-bottom: 4px;"><strong>当前模型:</strong> <code style="color: #8cc8ff;">${escapeHtml(model)}</code></div>`;
    html += `<div style="margin-bottom: 4px;"><strong>生成源:</strong> <span style="color: #aaa;">${escapeHtml(source)}</span></div>`;

    if (compat.errors.length > 0) {
        const err = compat.errors[0];
        html += `<div style="padding: 6px; background: rgba(255,50,50,0.15); border: 1px solid rgba(255,50,50,0.3); border-radius: 4px; color: #ff5050;">`;
        html += `<strong>❌ 不兼容: ${escapeHtml(err.name)}</strong><br>`;
        for (const issue of err.issues) {
            html += `• ${escapeHtml(issue)}<br>`;
        }
        html += `<span style="color: #ffaa00;">💡 ${escapeHtml(err.suggestion)}</span>`;
        html += `</div>`;
    } else if (compat.warnings.length > 0) {
        const warn = compat.warnings[0];
        html += `<div style="padding: 6px; background: rgba(255,200,0,0.1); border: 1px solid rgba(255,200,0,0.3); border-radius: 4px; color: #ffc800;">`;
        html += `<strong>⚠️ 警告: ${escapeHtml(warn.name)}</strong><br>`;
        for (const issue of warn.issues) {
            html += `• ${escapeHtml(issue)}<br>`;
        }
        html += `<span style="color: #aaa;">💡 ${escapeHtml(warn.suggestion)}</span>`;
        html += `</div>`;
    } else {
        html += `<div style="padding: 4px; background: rgba(0,200,100,0.1); border-radius: 4px; color: #00c864;">✅ 模型兼容性检查通过</div>`;
    }

    statusEl.innerHTML = html;
}

function updateWorkflowInfo(workflowName) {
    const infoEl = document.getElementById('si_workflow_info');
    if (!infoEl) return;

    if (!workflowName) {
        infoEl.style.display = 'none';
        return;
    }

    const desc = WORKFLOW_DESCRIPTIONS[workflowName];
    if (desc) {
        infoEl.innerHTML = `<strong>${escapeHtml(desc.core)}</strong><br><span style="color: #888;">${escapeHtml(desc.advantage)}</span>`;
        infoEl.style.display = 'block';
    } else {
        infoEl.innerHTML = `<span style="color: #888;">${escapeHtml(workflowName)}</span>`;
        infoEl.style.display = 'block';
    }
}


function extractCharacterInfo() {
    const context = getContext();
    const chid = this_chid;
    if (chid === undefined || !context.characters[chid]) return null;
    const char = context.characters[chid];
    const data = char.data || {};
    const ext = data.extensions || {};
    const sdPrompt = ext.sd_character_prompt || {};
    const rawDesc = (data.description || '');
    const rawPers = (data.personality || '');
    const rawScenario = (data.scenario || '');
    const rawFirstMes = (data.first_mes || '');
    const rawTags = (data.tags || []).join(', ');
    const rawSdPos = sdPrompt.positive || '';
    const rawExistingPrompt = getCharacterPrompt(char.name) || '';

    const fullText = [rawDesc, rawPers, rawScenario, rawFirstMes, rawTags, rawSdPos, rawExistingPrompt].join(' ').toLowerCase();
    const structured = parseCharacterFeatures(fullText);

    return {
        name: char.name || '',
        avatar: char.avatar || '',
        description: rawDesc.substring(0, 3000),
        personality: rawPers,
        scenario: rawScenario,
        firstMes: rawFirstMes.substring(0, 500),
        tags: rawTags,
        sdPositive: rawSdPos,
        sdNegative: sdPrompt.negative || '',
        existingPrompt: rawExistingPrompt,
        existingNegative: getCharacterNegative(char.name) || '',
        structured: structured,
        fullText: fullText,
    };
}

function parseCharacterFeatures(text) {
    const features = {
        gender: 'unknown', ageGroup: 'unknown',
        hairStyle: '', hairColor: '', eyeColor: '',
        bodyType: '', height: '',
        skinTone: '', ears: '',
        clothing: [], accessories: [],
        expression: '', personality: [],
        setting: '', era: '', atmosphere: '',
        race: '', occupation: '',
        distinctiveFeatures: [],
    };

    if (/\b(boy|male|man|he\/him|gentleman|lad)\b/.test(text)) features.gender = 'male';
    else if (/\b(girl|female|woman|she\/her|lady|lass)\b/.test(text)) features.gender = 'female';

    if (/\b(child|kid|young\s*boy|young\s*girl|toddler)\b/.test(text)) features.ageGroup = 'child';
    else if (/\b(teenager|teen|adolescent|young\s*man|young\s*woman|high\s*school)\b/.test(text)) features.ageGroup = 'teen';
    else if (/\b(middle[- ]aged|elderly|old\s*man|old\s*woman|grandfather|grandmother)\b/.test(text)) features.ageGroup = 'mature';
    else features.ageGroup = 'young_adult';

    const hairColors = [
        { words: ['silver hair', 'platinum hair', 'white hair'], tag: 'silver_hair' },
        { words: ['blonde hair', 'golden hair', 'yellow hair'], tag: 'blonde_hair' },
        { words: ['red hair', 'crimson hair', 'ginger hair', 'auburn hair'], tag: 'red_hair' },
        { words: ['black hair', 'dark hair', 'raven hair', 'jet-black hair'], tag: 'black_hair' },
        { words: ['brown hair', 'brunette', 'chestnut hair'], tag: 'brown_hair' },
        { words: ['blue hair', 'aqua hair', 'cyan hair'], tag: 'blue_hair' },
        { words: ['pink hair', 'magenta hair', 'rose hair'], tag: 'pink_hair' },
        { words: ['purple hair', 'violet hair', 'lavender hair'], tag: 'purple_hair' },
        { words: ['green hair'], tag: 'green_hair' },
        { words: ['orange hair'], tag: 'orange_hair' },
        { words: ['gray hair', 'grey hair'], tag: 'grey_hair' },
        { words: ['multicolored hair', 'two-tone hair', 'gradient hair', 'streaked hair'], tag: 'multicolored_hair' },
    ];
    for (const hc of hairColors) {
        if (hc.words.some(w => text.includes(w))) { features.hairColor = hc.tag; break; }
    }

    const hairStyles = [
        { words: ['long hair', 'flowing hair'], tag: 'long_hair' },
        { words: ['very long hair', 'absurdly long hair', 'floor-length hair'], tag: 'very_long_hair' },
        { words: ['short hair', 'cropped hair', 'bob cut', 'pixie cut'], tag: 'short_hair' },
        { words: ['medium hair', 'shoulder-length hair'], tag: 'medium_hair' },
        { words: ['twin tails', 'twintails', 'pigtails'], tag: 'twintails' },
        { words: ['ponytail'], tag: 'ponytail' },
        { words: ['braid', 'braided hair', 'plait'], tag: 'braided_hair' },
        { words: ['bun', 'hair bun', 'topknot'], tag: 'hair_bun' },
        { words: ['curly hair', 'ringlets', 'wavy hair'], tag: 'curly_hair' },
        { words: ['messy hair', 'bedhead', 'spiky hair'], tag: 'messy_hair' },
        { words: ['ahoge', 'antenna hair'], tag: 'ahoge' },
        { words: ['side ponytail'], tag: 'side_ponytail' },
    ];
    for (const hs of hairStyles) {
        if (hs.words.some(w => text.includes(w))) { features.hairStyle = hs.tag; break; }
    }

    const eyeColors = [
        { words: ['blue eyes', 'sapphire eyes'], tag: 'blue_eyes' },
        { words: ['red eyes', 'crimson eyes', 'ruby eyes', 'scarlet eyes'], tag: 'red_eyes' },
        { words: ['green eyes', 'emerald eyes'], tag: 'green_eyes' },
        { words: ['golden eyes', 'gold eyes', 'amber eyes', 'yellow eyes'], tag: 'golden_eyes' },
        { words: ['purple eyes', 'violet eyes', 'amethyst eyes'], tag: 'purple_eyes' },
        { words: ['silver eyes', 'gray eyes', 'grey eyes'], tag: 'silver_eyes' },
        { words: ['brown eyes', 'hazel eyes'], tag: 'brown_eyes' },
        { words: ['pink eyes'], tag: 'pink_eyes' },
        { words: ['heterochromia', 'different colored eyes', 'mismatched eyes'], tag: 'heterochromia' },
    ];
    for (const ec of eyeColors) {
        if (ec.words.some(w => text.includes(w))) { features.eyeColor = ec.tag; break; }
    }

    if (/\b(tall|towering|statuesque)\b/.test(text)) features.height = 'tall';
    else if (/\b(short|petite|small stature)\b/.test(text)) features.height = 'short';

    if (/\b(elf|elven|pointy ears|pointed ears)\b/.test(text)) features.ears = 'pointy_ears';
    else if (/\b(cat ears|nekomimi|catgirl)\b/.test(text)) features.ears = 'cat_ears';
    else if (/\b(fox ears|kitsune)\b/.test(text)) features.ears = 'fox_ears';
    else if (/\b(rabbit ears|bunny girl)\b/.test(text)) features.ears = 'rabbit_ears';
    else if (/\b(demon horns|horns)\b/.test(text)) features.ears = 'horns';

    const clothingMap = [
        { words: ['school uniform', 'seifuku', 'sailor uniform'], tag: 'school_uniform' },
        { words: ['maid dress', 'maid outfit', 'maid uniform'], tag: 'maid_outfit' },
        { words: ['kimono', 'furisode'], tag: 'kimono' },
        { words: ['hanfu', 'chinese clothes', 'cheongsam', 'qipao'], tag: 'hanfu' },
        { words: ['armor', 'plate armor', 'knight armor', 'breastplate'], tag: 'armor' },
        { words: ['dress', 'gown', 'ball gown', 'evening dress'], tag: 'dress' },
        { words: ['suit', 'business suit', 'tuxedo'], tag: 'suit' },
        { words: ['casual', 'casual clothes', 't-shirt', 'hoodie'], tag: 'casual_clothes' },
        { words: ['gothic', 'gothic lolita', 'goth'], tag: 'gothic_lolita' },
        { words: ['witch hat', 'witch', 'sorceress robe'], tag: 'witch_hat' },
        { words: ['priestess', 'shrine maiden', 'miko'], tag: 'miko' },
        { words: ['nurse uniform', 'nurse outfit'], tag: 'nurse_uniform' },
        { words: ['military uniform', 'soldier uniform'], tag: 'military_uniform' },
        { words: ['lab coat', 'scientist'], tag: 'lab_coat' },
        { words: ['bikini', 'swimsuit', 'swimwear'], tag: 'swimsuit' },
        { words: ['cloak', 'cape', 'hooded cloak', 'robe'], tag: 'cloak' },
        { words: ['apron'], tag: 'apron' },
        { words: ['wedding dress', 'bridal gown'], tag: 'wedding_dress' },
    ];
    for (const cm of clothingMap) {
        if (cm.words.some(w => text.includes(w))) features.clothing.push(cm.tag);
    }
    if (features.clothing.length === 0) features.clothing.push('default_clothes');

    const accessoryMap = [
        { words: ['glasses', 'spectacles'], tag: 'glasses' },
        { words: ['eyepatch'], tag: 'eyepatch' },
        { words: ['scar', 'scars', 'facial scar'], tag: 'scar' },
        { words: ['tattoo', 'tattoos', 'markings'], tag: 'tattoo' },
        { words: ['earrings', 'piercing'], tag: 'earrings' },
        { words: ['necklace', 'pendant', 'choker'], tag: 'necklace' },
        { words: ['hat', 'beret', 'fedora'], tag: 'hat' },
        { words: ['ribbon', 'hair ribbon', 'bow'], tag: 'ribbon' },
        { words: ['sword', 'katana', 'weapon'], tag: 'holding_weapon' },
        { words: ['book', 'grimoire', 'tome'], tag: 'holding_book' },
        { words: ['wings', 'angel wings', 'fairy wings'], tag: 'wings' },
        { words: ['tail', 'cat tail', 'fox tail'], tag: 'tail' },
        { words: ['halo'], tag: 'halo' },
        { words: ['mask', 'half mask'], tag: 'mask' },
    ];
    for (const am of accessoryMap) {
        if (am.words.some(w => text.includes(w))) features.accessories.push(am.tag);
    }

    const expressionMap = [
        { words: ['smile', 'cheerful', 'happy', 'joyful', 'bright smile'], tag: 'smile' },
        { words: ['serious', 'stoic', 'expressionless', 'cold'], tag: 'serious' },
        { words: ['shy', 'timid', 'blush', 'embarrassed'], tag: 'blush' },
        { words: ['angry', 'fierce', 'glaring', 'furious'], tag: 'angry' },
        { words: ['sad', 'melancholy', 'tearful', 'crying'], tag: 'sad' },
        { words: ['mischievous', 'smirk', 'sly smile', 'playful'], tag: 'smirk' },
        { words: ['gentle', 'kind smile', 'warm smile'], tag: 'gentle_smile' },
        { words: ['confident', 'determined', 'strong-willed'], tag: 'confident' },
        { words: ['mysterious', 'enigmatic', 'alluring'], tag: 'mysterious' },
    ];
    for (const em of expressionMap) {
        if (em.words.some(w => text.includes(w))) { features.expression = em.tag; break; }
    }

    const personalityMap = [
        { words: ['tsundere'], tag: 'tsundere' },
        { words: ['yandere'], tag: 'yandere' },
        { words: ['kuudere'], tag: 'kuudere' },
        { words: ['dandere'], tag: 'dandere' },
        { words: ['energetic', 'hyperactive', 'bubbly'], tag: 'energetic' },
        { words: ['calm', 'composed', 'serene'], tag: 'calm' },
        { words: ['arrogant', 'proud', 'haughty'], tag: 'arrogant' },
        { words: ['cunning', 'scheming', 'manipulative'], tag: 'cunning' },
        { words: ['innocent', 'naive', 'pure'], tag: 'innocent' },
    ];
    for (const pm of personalityMap) {
        if (pm.words.some(w => text.includes(w))) features.personality.push(pm.tag);
    }

    const settingMap = [
        { words: ['medieval', 'fantasy world', 'sword and sorcery', 'dungeon'], tag: 'fantasy' },
        { words: ['modern', 'contemporary', 'city', 'urban'], tag: 'modern' },
        { words: ['sci-fi', 'cyberpunk', 'space', 'futuristic', 'mecha'], tag: 'sci-fi' },
        { words: ['feudal japan', 'edo period', 'samurai', 'ninja'], tag: 'feudal_japan' },
        { words: ['ancient china', 'imperial china', 'dynasty'], tag: 'ancient_china' },
        { words: ['victorian', 'steampunk', '19th century'], tag: 'victorian' },
        { words: ['post-apocalyptic', 'wasteland', 'dystopia'], tag: 'post-apocalyptic' },
        { words: ['school', 'academy', 'campus'], tag: 'school' },
    ];
    for (const sm of settingMap) {
        if (sm.words.some(w => text.includes(w))) { features.setting = sm.tag; break; }
    }

    const raceMap = [
        { words: ['vampire'], tag: 'vampire' },
        { words: ['demon', 'succubus', 'incubus'], tag: 'demon' },
        { words: ['angel'], tag: 'angel' },
        { words: ['elf', 'elven'], tag: 'elf' },
        { words: ['dragon', 'dragonkin', 'draconic'], tag: 'dragon' },
        { words: ['fairy', 'fae', 'fey'], tag: 'fairy' },
        { words: ['mermaid', 'merfolk'], tag: 'mermaid' },
        { words: ['robot', 'android', 'cyborg', 'artificial'], tag: 'robot' },
        { words: ['zombie', 'undead', 'ghost'], tag: 'undead' },
        { words: ['werewolf', 'lycan'], tag: 'werewolf' },
    ];
    for (const rm of raceMap) {
        if (rm.words.some(w => text.includes(w))) { features.race = rm.tag; break; }
    }

    const occupationMap = [
        { words: ['princess', 'queen', 'prince', 'king', 'royal'], tag: 'royalty' },
        { words: ['knight', 'paladin', 'warrior'], tag: 'knight' },
        { words: ['mage', 'wizard', 'sorceress', 'witch', 'magician'], tag: 'mage' },
        { words: ['assassin', 'rogue', 'thief', 'ninja'], tag: 'assassin' },
        { words: ['priestess', 'cleric', 'healer', 'nun'], tag: 'priestess' },
        { words: ['student', 'schoolgirl', 'schoolboy'], tag: 'student' },
        { words: ['teacher', 'professor', 'instructor'], tag: 'teacher' },
        { words: ['doctor', 'nurse', 'surgeon'], tag: 'doctor' },
        { words: ['detective', 'investigator'], tag: 'detective' },
        { words: ['idol', 'singer', 'pop star'], tag: 'idol' },
    ];
    for (const om of occupationMap) {
        if (om.words.some(w => text.includes(w))) { features.occupation = om.tag; break; }
    }

    if (/\b(pale skin|fair skin|porcelain skin)\b/.test(text)) features.skinTone = 'pale_skin';
    else if (/\b(dark skin|tan skin|brown skin)\b/.test(text)) features.skinTone = 'dark_skin';

    return features;
}

function buildStructuredAvatarPrompt(charInfo) {
    if (!charInfo || !charInfo.structured) return '1girl, portrait, upper_body, looking_at_viewer';
    const s = charInfo.structured;
    let tags = [];

    tags.push(s.gender === 'male' ? '1boy' : '1girl');

    if (s.ageGroup === 'child') tags.push('child', 'loli');
    else if (s.ageGroup === 'teen') tags.push('teenager');
    else if (s.ageGroup === 'mature') tags.push('mature_female');

    tags.push('portrait', 'upper_body', 'looking_at_viewer');

    if (s.hairColor) tags.push(s.hairColor);
    if (s.hairStyle) tags.push(s.hairStyle);
    if (s.eyeColor) tags.push(s.eyeColor);
    if (s.skinTone) tags.push(s.skinTone);
    if (s.ears) tags.push(s.ears);
    if (s.height === 'tall') tags.push('tall');
    else if (s.height === 'short') tags.push('petite');

    if (s.race) tags.push(s.race);

    for (const c of s.clothing.slice(0, 2)) tags.push(c);
    for (const a of s.accessories.slice(0, 3)) tags.push(a);

    if (s.expression) tags.push(s.expression);

    if (s.occupation) tags.push(s.occupation);

    if (s.setting === 'fantasy') tags.push('fantasy_background');
    else if (s.setting === 'sci-fi') tags.push('sci-fi_background');
    else if (s.setting === 'feudal_japan') tags.push('japanese_background');
    else if (s.setting === 'ancient_china') tags.push('chinese_background');
    else if (s.setting === 'school') tags.push('school_background');

    if (charInfo.existingPrompt) {
        const existing = charInfo.existingPrompt.split(',').map(t => t.trim()).filter(t => t.length > 0);
        const existingLower = existing.map(t => t.toLowerCase());
        for (const t of existing.slice(0, 15)) {
            if (!tags.some(et => et.toLowerCase() === t.toLowerCase())) {
                if (!existingLower.includes('masterpiece') && !existingLower.includes('best quality')) {
                    tags.push(t);
                }
            }
        }
    }

    return tags.join(', ');
}

function assessPromptConsistency(prompt, charInfo) {
    if (!charInfo || !charInfo.structured) return { score: 0, missing: [], details: '' };
    const s = charInfo.structured;
    const promptLower = prompt.toLowerCase();
    let score = 0;
    let total = 0;
    const missing = [];

    const checks = [
        { name: '性别', present: (s.gender !== 'unknown'), matched: (s.gender === 'male' ? promptLower.includes('1boy') : promptLower.includes('1girl')) },
        { name: '发色', present: !!s.hairColor, matched: s.hairColor ? promptLower.includes(s.hairColor.replace(/_/g, ' ')) || promptLower.includes(s.hairColor) : true },
        { name: '瞳色', present: !!s.eyeColor, matched: s.eyeColor ? promptLower.includes(s.eyeColor.replace(/_/g, ' ')) || promptLower.includes(s.eyeColor) : true },
        { name: '发型', present: !!s.hairStyle, matched: s.hairStyle ? promptLower.includes(s.hairStyle.replace(/_/g, ' ')) || promptLower.includes(s.hairStyle) : true },
        { name: '服饰', present: s.clothing.length > 0 && s.clothing[0] !== 'default_clothes', matched: s.clothing.some(c => promptLower.includes(c.replace(/_/g, ' ')) || promptLower.includes(c)) },
        { name: '表情', present: !!s.expression, matched: s.expression ? promptLower.includes(s.expression.replace(/_/g, ' ')) || promptLower.includes(s.expression) : true },
        { name: '种族', present: !!s.race, matched: s.race ? promptLower.includes(s.race) : true },
        { name: '配饰', present: s.accessories.length > 0, matched: s.accessories.some(a => promptLower.includes(a.replace(/_/g, ' ')) || promptLower.includes(a)) },
    ];

    for (const check of checks) {
        if (check.present) {
            total++;
            if (check.matched) score++;
            else missing.push(check.name);
        }
    }

    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const details = `特征匹配: ${score}/${total} (${pct}%) | 缺失: ${missing.length > 0 ? missing.join(', ') : '无'}`;
    return { score: pct, missing, details };
}

async function generateAvatarPrompt(charInfo) {
    if (!charInfo) return null;
    const settings = getSettings();
    let method = settings.expansionMethod || 'direct';

    const hasRemoteApi = !!(settings.remoteApiUrl && settings.remoteApiKey);
    const hasOllama = !!settings.ollamaUrl;
    const hasStLlm = typeof generateQuietPrompt === 'function';

    if (method === 'direct') {
        if (hasRemoteApi) { method = 'remote_api'; console.log('[Story-Images] Auto-detected Remote API for avatar generation'); }
        else if (hasOllama) { method = 'ollama'; console.log('[Story-Images] Auto-detected Ollama for avatar generation'); }
        else if (hasStLlm) { method = 'st_llm'; console.log('[Story-Images] Auto-detected ST LLM for avatar generation'); }
        else { console.log('[Story-Images] No AI available, using local feature extraction'); }
    }

    const structuredDesc = charInfo.structured ? formatStructuredFeatures(charInfo.structured) : 'Not available';

    const systemPrompt = `You are an expert character designer and Stable Diffusion prompt engineer. Your task has TWO phases:

PHASE 1 - ANALYZE the character from the story:
- Extract ALL visual characteristics from the description, personality, scenario and existing prompts
- Infer visual details that are implied but not explicitly stated (e.g., "warrior" implies armor/weapons, "noble" implies elegant clothing)
- Consider the story setting/scenario to determine appropriate background, clothing style, and atmosphere
- Consider the personality to determine facial expression, pose, and overall mood
- If the character is from a specific era/setting, ensure all visual elements match that setting

PHASE 2 - GENERATE SD tags:
- Output ONLY comma-separated SD tags, nothing else
- Use underscores for multi-word tags: "long_silver_hair" not "long silver hair"
- Start with subject tag: "1girl" or "1boy"
- Include composition: "portrait, upper_body, looking_at_viewer"
- Do NOT include quality tags (masterpiece, best quality, etc.) - they are added automatically
- No Chinese characters, no explanations, no markdown, no categories
- MUST include ALL visual features from Phase 1 analysis
- Each feature (hair, eyes, clothing, etc.) must appear as at least one SD tag
- If the character has distinctive features (horns, wings, tail, etc.), they MUST be included
- Include background tags that match the story setting
- Include atmosphere/mood tags based on personality and story tone

STRUCTURED CHARACTER FEATURES (detected from text, MUST include all):
${structuredDesc}

FULL CHARACTER AND STORY INFO:
Name: ${charInfo.name}
Description: ${charInfo.description}
Personality: ${charInfo.personality}
Story/Scenario: ${charInfo.scenario || 'Not specified'}
First Message: ${charInfo.firstMes || 'Not available'}
Tags: ${charInfo.tags || 'None'}
Existing SD Prompt: ${charInfo.existingPrompt || charInfo.sdPositive || 'None'}

Analyze the character and generate a portrait/avatar prompt:`;

    const userPrompt = `Analyze this character and generate SD portrait tags:

CHARACTER: ${charInfo.name}
DETECTED FEATURES: ${structuredDesc}
DESCRIPTION: ${charInfo.description || 'No description'}
PERSONALITY: ${charInfo.personality || 'No personality'}
STORY/SCENARIO: ${charInfo.scenario || 'Not specified'}
FIRST MESSAGE: ${charInfo.firstMes || 'Not available'}
TAGS: ${charInfo.tags || 'None'}
EXISTING SD PROMPT: ${charInfo.existingPrompt || charInfo.sdPositive || 'None'}

Step 1: Analyze what this character looks like based on ALL information above. Infer any visual details implied by personality, occupation, or setting.
Step 2: Generate comma-separated SD tags for a portrait that captures this character accurately. Include background and atmosphere matching the story setting.

SD tags:`;

    try {
        if (method === 'remote_api' && settings.remoteApiUrl && settings.remoteApiKey) {
            const response = await fetch(settings.remoteApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.remoteApiKey}` },
                body: JSON.stringify({
                    model: settings.remoteApiModel || 'gpt-4o-mini',
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                    temperature: 0.7, max_tokens: 500,
                }),
            });
            if (!response.ok) throw new Error(`API error: ${response.status}`);
            const data = await response.json();
            return data.choices?.[0]?.message?.content?.trim() || null;
        }
        if (method === 'ollama' && settings.ollamaUrl) {
            const response = await fetch(`${settings.ollamaUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: settings.ollamaModel || 'qwen2.5:7b',
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                    stream: false,
                }),
            });
            if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
            const data = await response.json();
            return data.message?.content?.trim() || null;
        }
        if (method === 'st_llm') {
            const combinedPrompt = `[System Instructions: ${systemPrompt}]

${userPrompt}`;
            return await generateQuietPrompt(combinedPrompt, false, false);
        }
        return buildAvatarPromptFromInfo(charInfo);
    } catch (e) {
        console.warn('[Story-Images] Avatar prompt generation failed, using fallback:', e.message);
        return buildAvatarPromptFromInfo(charInfo);
    }
}

function formatStructuredFeatures(s) {
    if (!s) return 'No structured features available';
    const parts = [];
    if (s.gender !== 'unknown') parts.push(`Gender: ${s.gender}`);
    if (s.ageGroup !== 'unknown') parts.push(`Age: ${s.ageGroup}`);
    if (s.hairColor) parts.push(`Hair color: ${s.hairColor.replace(/_/g, ' ')}`);
    if (s.hairStyle) parts.push(`Hair style: ${s.hairStyle.replace(/_/g, ' ')}`);
    if (s.eyeColor) parts.push(`Eye color: ${s.eyeColor.replace(/_/g, ' ')}`);
    if (s.skinTone) parts.push(`Skin: ${s.skinTone.replace(/_/g, ' ')}`);
    if (s.ears) parts.push(`Ears/Horns: ${s.ears.replace(/_/g, ' ')}`);
    if (s.height) parts.push(`Height: ${s.height}`);
    if (s.race) parts.push(`Race: ${s.race}`);
    if (s.clothing.length > 0 && s.clothing[0] !== 'default_clothes') parts.push(`Clothing: ${s.clothing.map(c => c.replace(/_/g, ' ')).join(', ')}`);
    if (s.accessories.length > 0) parts.push(`Accessories: ${s.accessories.map(a => a.replace(/_/g, ' ')).join(', ')}`);
    if (s.expression) parts.push(`Expression: ${s.expression.replace(/_/g, ' ')}`);
    if (s.occupation) parts.push(`Occupation: ${s.occupation}`);
    if (s.setting) parts.push(`Setting: ${s.setting.replace(/_/g, ' ')}`);
    if (s.personality.length > 0) parts.push(`Personality: ${s.personality.join(', ')}`);
    return parts.length > 0 ? parts.join('\n') : 'No specific features detected';
}

function buildAvatarPromptFromInfo(charInfo) {
    return buildStructuredAvatarPrompt(charInfo);
}

async function generateAvatarImage() {
    const sd = extension_settings.sd;
    if (!sd) { showToast('图片生成扩展未加载，请在扩展管理中确认Image Generation已启用', 'error'); return null; }
    if (!sd.source || sd.source === 'extras') {
        const settings = getSettings();
        if (settings.cnbEnabled) {
            const ready = await cnbEnsureServiceReady();
            if (!ready || extension_settings.sd?.source !== 'comfy') {
                showToast('图片生成源未配置，请先在Image Generation扩展中选择ComfyUI并配置连接地址', 'error');
                return null;
            }
        } else {
            showToast('图片生成源未配置，请在Image Generation扩展设置中选择生成源（如ComfyUI）', 'error');
            return null;
        }
    }
    const _generatePicture = await waitForGeneratePicture();
    if (!_generatePicture) { showToast('图片生成功能不可用，请确保已启用Image Generation扩展并配置了生成源', 'error'); return null; }
    const charInfo = extractCharacterInfo();
    if (!charInfo) { showToast('无法获取角色信息', 'error'); return null; }
    showToast(`🎨 正在为 ${charInfo.name} 生成头像...`, 'info');
    const avatarPrompt = await generateAvatarPrompt(charInfo);
    if (!avatarPrompt) { showToast('提示词生成失败', 'error'); return null; }
    const sanitizedPrompt = sanitizeExpandedPrompt(avatarPrompt);
    console.log(`[Story-Images] Avatar prompt: "${sanitizedPrompt.substring(0, 200)}..."`);
    const settings = getSettings();
    if (settings.cnbEnabled && sd.source === 'comfy') {
        const serviceReady = await cnbEnsureServiceReady();
        if (!serviceReady) { showToast('❌ ComfyUI服务不可用', 'error'); return null; }
    }
    const styleConfig = getStyleConfig();
    const sdOverrides = {
        free_extend: false,
        command_visible: false,
        prompt_prefix: styleConfig.promptPrefix,
        scale: styleConfig.scale,
        steps: styleConfig.steps,
        sampler: styleConfig.sampler,
        width: 512,
        height: 768,
    };
    if (styleConfig.negativeExtra) {
        const base = sd.negative_prompt || '';
        if (!base.includes(styleConfig.negativeExtra.trim().substring(2))) sdOverrides.negative_prompt = base + styleConfig.negativeExtra;
    }
    if (styleConfig.workflow && sd.source === 'comfy' && !settings.comfyWorkflow) sdOverrides.comfy_workflow = styleConfig.workflow;
    else if (settings.comfyWorkflow && sd.source === 'comfy') sdOverrides.comfy_workflow = settings.comfyWorkflow;
    if (sd.source === 'comfy' && sd.model) {
        try {
            const comfyUrl = (sd.comfy_url || 'http://127.0.0.1:8188').replace(/\/+$/, '');
            const resp = await fetch(`${comfyUrl}/object_info/CheckpointLoaderSimple`);
            if (resp.ok) {
                const data = await resp.json();
                const availableModels = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
                if (!availableModels.includes(sd.model)) {
                    const fallback = findBestFallbackModel(availableModels, settings.style || 'anime');
                    if (fallback) sdOverrides.model = fallback;
                }
            }
        } catch (_) {}
    }
    return await withSdSettings(sdOverrides, async () => {
        const trigger = sanitizedPrompt;
        const args = {};
        if (charInfo.existingNegative || styleConfig.negativeExtra) args.negative = (charInfo.existingNegative || '') + (styleConfig.negativeExtra || '');
        try {
            const result = await _generatePicture('command', args, trigger);
            if (result) {
                showToast(`✅ ${charInfo.name} 头像生成成功!`, 'success');
                showAvatarPreview(result, charInfo, sanitizedPrompt);
            }
            return result;
        } catch (e) {
            console.error('[Story-Images] Avatar generation error:', e);
            showToast(`❌ 头像生成失败: ${e.message}`, 'error');
            return null;
        }
    });
}

function showAvatarPreview(imageData, charInfo, prompt) {
    let overlay = document.getElementById('si_avatar_overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'si_avatar_overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#1a1a2e;border-radius:12px;padding:20px;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
    let imgSrc;
    if (imageData.startsWith('data:')) {
        imgSrc = imageData;
    } else if (imageData.startsWith('http') || imageData.startsWith('/')) {
        imgSrc = imageData;
    } else {
        imgSrc = '/' + imageData.replace(/^\/+/, '');
    }
    card.innerHTML = `
        <h3 style="margin:0 0 12px;color:#e2e8f0;">🎨 ${escapeHtml(charInfo.name)} 头像预览</h3>
        <img src="${escapeHtml(imgSrc)}" style="max-width:256px;max-height:384px;border-radius:8px;border:2px solid #4a9eff;margin-bottom:12px;" />
        <div style="font-size:11px;color:#888;margin-bottom:8px;max-height:60px;overflow-y:auto;text-align:left;padding:6px;background:rgba(0,0,0,0.3);border-radius:4px;">
            <strong>提示词:</strong> ${escapeHtml(prompt.substring(0, 300))}${prompt.length > 300 ? '...' : ''}
        </div>
        <div id="si_consistency_info" style="font-size:11px;margin-bottom:12px;text-align:left;padding:6px;background:rgba(0,0,0,0.2);border-radius:4px;color:#aaa;">
            正在评估一致性...
        </div>
        <div style="display:flex;gap:8px;justify-content:center;">
            <button id="si_avatar_apply" style="padding:8px 20px;background:#00c864;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;">✅ 替换头像</button>
            <button id="si_avatar_regen" style="padding:8px 20px;background:#4a9eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">🔄 重新生成</button>
            <button id="si_avatar_cancel" style="padding:8px 20px;background:#666;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">❌ 取消</button>
        </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.getElementById('si_avatar_apply')?.addEventListener('click', async function() {
        this.disabled = true; this.textContent = '应用中...';
        try {
            const saved = await applyAvatarToCharacter(imageData, charInfo);
            if (saved) { showToast(`✅ ${charInfo.name} 头像已替换!`, 'success'); overlay.remove(); }
        } catch (e) { showToast(`❌ 替换失败: ${e.message}`, 'error'); this.disabled = false; this.textContent = '✅ 替换头像'; }
    });
    document.getElementById('si_avatar_regen')?.addEventListener('click', function() { overlay.remove(); generateAvatarImage(); });
    document.getElementById('si_avatar_cancel')?.addEventListener('click', function() { overlay.remove(); });

    setTimeout(() => {
        const assessment = assessPromptConsistency(prompt, charInfo);
        const infoEl = document.getElementById('si_consistency_info');
        if (infoEl) {
            const color = assessment.score >= 80 ? '#00c864' : assessment.score >= 50 ? '#ffc800' : '#ff5050';
            infoEl.innerHTML = `<span style="color:${color};font-weight:bold;">一致性: ${assessment.score}%</span> | ${escapeHtml(assessment.details)}`;
        }
    }, 100);
}

async function applyAvatarToCharacter(imageData, charInfo) {
    const context = getContext();
    const chid = this_chid;
    if (chid === undefined || !context.characters[chid]) { showToast('无法获取角色信息', 'error'); return false; }
    const char = context.characters[chid];
    const charName = char.name || charInfo.name;
    const oldAvatar = char.avatar || `${charName}.png`;

    try {
        let base64Data;
        if (imageData.startsWith('data:')) {
            base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        } else {
            const imgUrl = imageData.startsWith('/') ? imageData : '/' + imageData;
            const imgResponse = await fetch(imgUrl);
            if (!imgResponse.ok) throw new Error(`获取图片失败: HTTP ${imgResponse.status}`);
            const imgBlob = await imgResponse.blob();
            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.replace(/^data:image\/\w+;base64,/, ''));
                reader.onerror = reject;
                reader.readAsDataURL(imgBlob);
            });
        }

        const byteCharacters = atob(base64Data);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteArray[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: 'image/png' });

        const formData = new FormData();
        formData.append('avatar', blob, `${charName}.png`);
        formData.append('avatar_url', oldAvatar);
        formData.append('ch_name', charName);

        const headers = getRequestHeaders({ omitContentType: true });
        const response = await fetch('/api/characters/edit-avatar', {
            method: 'POST',
            headers: headers,
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        char.avatar = `${charName}.png`;
        const avatarElements = document.querySelectorAll(`img[src*="${oldAvatar}"]`);
        avatarElements.forEach(el => {
            el.src = `characters/${charName}.png?t=${Date.now()}`;
        });

        if (typeof getCharacters === 'function') {
            await getCharacters();
        }
        return true;
    } catch (e) {
        console.error('[Story-Images] Apply avatar error:', e);
        showToast(`❌ 头像替换失败: ${e.message}`, 'error');
        return false;
    }
}


const SI_REGEN_CSS = document.createElement('style');
SI_REGEN_CSS.textContent = `
    .si-regen-btn {
        background: rgba(74,158,255,0.15);
        border: 1px solid rgba(74,158,255,0.35);
        color: #8cc8ff;
        border-radius: 10px;
        padding: 1px 6px;
        font-size: 0.85em;
        cursor: pointer;
        margin-left: 2px;
        transition: all 0.2s ease;
        line-height: 1.4;
        user-select: none;
    }
    .si-regen-btn:hover {
        background: rgba(74,158,255,0.35);
        border-color: rgba(74,158,255,0.6);
        transform: scale(1.08);
        box-shadow: 0 1px 6px rgba(74,158,255,0.2);
    }
    .si-regen-btn:active {
        background: rgba(74,158,255,0.5);
        transform: scale(0.95);
    }
    .si-regen-btn.si-regen-loading {
        animation: siRegenSpin 1s linear infinite;
        pointer-events: none;
        color: #ffc800;
        border-color: rgba(255,200,0,0.4);
        background: rgba(255,200,0,0.1);
    }
    @keyframes siRegenSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .si-gen-btn.si-gen-done {
        background: rgba(0,200,100,0.12) !important;
        border-color: rgba(0,200,100,0.35) !important;
        color: #4ade80 !important;
        cursor: pointer !important;
    }
    .si-gen-btn.si-gen-done:hover:not(:disabled) {
        background: rgba(0,200,100,0.25) !important;
        border-color: rgba(0,200,100,0.5) !important;
        box-shadow: 0 1px 6px rgba(0,200,100,0.2);
        transform: translateY(-1px);
    }
    .si-gen-btn.si-gen-done:active:not(:disabled) {
        background: rgba(0,200,100,0.35) !important;
        transform: translateY(0);
    }
    .si-auto-generated {
        transition: all 0.2s ease;
    }
    .si-auto-generated:hover {
        background: rgba(74,158,255,0.18) !important;
    }
    #si_top_nav_content {
        min-width: min(450px, 90vw);
    }
    #si_top_nav_icon.openIcon {
        color: #4a9eff;
    }
`;
SI_REGEN_CSS.id = 'si_regen_css';
if (!document.getElementById('si_regen_css')) {
    document.head.appendChild(SI_REGEN_CSS);
}


let siTopNavDrawer = null;

function initTopNavIcon() {
    if (siTopNavDrawer) return;

    const drawerHtml = `
        <div id="si_top_nav_button" class="drawer">
            <div class="drawer-toggle">
                <div id="si_top_nav_icon" class="drawer-icon fa-solid fa-image fa-fw closedIcon interactable"
                     title="图片功能辅助" tabindex="0"></div>
            </div>
            <div id="si_top_nav_content" class="drawer-content closedDrawer">
                <div id="story_images_settings_container" class="story-images-settings" style="padding: 10px; max-height: calc(100vh - var(--topBarBlockSize, 50px) - var(--bottomFormBlockSize, 50px)); overflow-y: auto;"></div>
            </div>
        </div>
    `;

    $('#extensions-settings-button').after(drawerHtml);
    siTopNavDrawer = document.getElementById('si_top_nav_button');

    const toggle = $('#si_top_nav_button .drawer-toggle');
    if (typeof doNavbarIconClick === 'function') {
        toggle.on('click', doNavbarIconClick);
    } else {
        toggle.on('click', function () {
            const icon = $(this).find('.drawer-icon');
            const drawerContent = $(this).parent().find('.drawer-content');
            const wasOpen = drawerContent.hasClass('openDrawer');
            if (!wasOpen) {
                $('.openDrawer:not(.pinnedOpen)').toggleClass('closedDrawer openDrawer');
                $('.openIcon:not(.drawerPinnedOpen)').toggleClass('closedIcon openIcon');
            }
            icon.toggleClass('closedIcon openIcon');
            drawerContent.toggleClass('closedDrawer openDrawer');
        });
    }
}

function toggleTopNavIcon(show) {
    if (show) {
        if (siTopNavDrawer) siTopNavDrawer.style.display = '';
    } else {
        if (siTopNavDrawer) siTopNavDrawer.style.display = 'none';
    }
}
jQuery(async () => {
    if (extension_settings['story-images'] && !extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = extension_settings['story-images'];
        delete extension_settings['story-images'];
        saveSettingsDebounced();
        console.log('[Story-Images] Migrated settings from old key "story-images" to "sillytavern-image-assistant"');
    }
    const settings = getSettings();
    initDefaultCharacterPrompts();
    registerSlashCommands();

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            const mesElements = document.querySelectorAll('.mes[mesid]');
            for (const mesEl of mesElements) {
                const messageId = parseInt(mesEl.getAttribute('mesid'));
                if (!isNaN(messageId)) {
                    processChoiceButtons(messageId);
                }
            }
            bindAutoRegenButtons();
        }, 800);
    });

    const sidebarHtml = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>📷 图片功能辅助</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div id="si_sidebar_minimal" class="story-images-settings" style="padding: 10px;">
                    <label style="display:flex;align-items:center;gap:6px;margin:4px 0;">
                        <input type="checkbox" id="si_sidebar_top_nav_toggle" ${settings.showTopNavIcon ? 'checked' : ''}>
                        <span>显示顶部导航栏图标</span>
                    </label>
                    <div style="margin:4px 0 0 26px;padding:6px 8px;background:rgba(74,158,255,0.08);border-radius:4px;font-size:11px;color:#8cc8ff;">
                        勾选后，在顶部导航栏添加📷图标，点击即可打开完整设置面板
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings').append(sidebarHtml);

    document.getElementById('si_sidebar_top_nav_toggle')?.addEventListener('change', function () {
        settings.showTopNavIcon = !!this.checked;
        saveSettingsDebounced();
        toggleTopNavIcon(settings.showTopNavIcon);
    });

    fetchOllamaModels().catch(() => { });
    fetchComfyWorkflows().catch(() => { });
    if (settings.remoteApiUrl && settings.remoteApiKey) {
        fetchRemoteApiModels().catch(() => { });
    }

    if (settings.style && extension_settings.sd) {
        applyStyleToSdConfig(settings.style);
    }

    if (settings.cnbEnabled) {
        cnbStartStatusPolling();
        if (settings.cnbKeepAlive) {
            cnbStartKeepAlive();
        }
        setTimeout(async () => {
            const comfyUrl = extension_settings.sd?.comfy_url || 'http://127.0.0.1:8188';
            const status = await cnbCheckComfyStatus(comfyUrl);
            if (status.online) {
                cnbServiceState.status = 'online';
                cnbServiceState.lastCheck = new Date().toISOString();
                cnbUpdateStatusUI('online', '服务在线');
            } else {
                cnbServiceState.status = 'offline';
                cnbUpdateStatusUI('offline', '服务离线');
            }
        }, 2000);
    }

    initTopNavIcon();
    toggleTopNavIcon(settings.showTopNavIcon);

    await loadSettingsUI();

    if (settings.cnbApiToken) {
        setTimeout(() => cnbFetchRepos(), 500);
    }

    setTimeout(() => scanAllVisibleMessages(), 1500);

    console.log('[Story-Images] 图片功能辅助 v2.7.0 - Fix model fallback when recommended model unavailable in ComfyUI');
});
