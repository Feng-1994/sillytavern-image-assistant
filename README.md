# 📷 图片功能辅助 (Image Assistant)

SillyTavern 扩展插件 - 为角色扮演提供智能图片生成辅助功能。

## ✨ 功能特性

- 🎨 **智能图片生成** - 根据故事情节和人物特征自动生成匹配的图片
- 🔄 **重新生成** - 对不满意的生成结果一键重新生成
- 📷 **顶部导航栏** - 可选的顶部导航栏图标，快速访问完整设置面板
- 🎭 **头像生成** - 基于AI分析故事内容生成匹配的角色头像
- 📋 **批量导出** - 角色卡和世界书批量导出与完整备份
- 🔌 **多模型支持** - 支持 ComfyUI (Animagine XL / Juggernaut XL) 和 SD Web UI
- 🤖 **AI提示词增强** - 自动调用AI大模型优化生成提示词
- ☁️ **CNB ComfyUI 一键启动** - 全新自动化流程，从Token验证到连接测试全程自动化
- 🎯 **选择按钮** - 在聊天中提供交互式选择按钮

## 🚀 v2.1 重大更新

### 🎯 安装即用，无需额外配置

扩展安装后即可直接使用所有基础CNB功能（Token验证、仓库管理、工作空间控制），无需运行安装脚本或手动配置后端插件。

**工作原理：** 扩展自动利用 SillyTavern 内置的 CORS 代理（`enableCorsProxy`，默认开启）通过 `X-Target-Authorization` 头安全地转发 CNB API Token，实现浏览器端直接调用 CNB API。

**API调用优先级：**
1. **Server Plugin**（如已安装）→ 直接使用 `/api/plugins/` 路由
2. **CORS Proxy**（默认可用）→ 通过 `/proxy/` + `X-Target-Authorization` 头
3. **提示启用** → 显示 config.yaml 配置指引

### ☁️ CNB ComfyUI 一键启动

6步自动化流程，从输入Token到完成连接测试全程无需手动干预：

1. **验证API Token和仓库** - 自动检查Token有效性和仓库可访问性
2. **启动云开发环境** - 自动创建并启动CNB Workspace
3. **等待环境就绪** - 实时监控构建状态，动态更新进度
4. **建立SSH隧道** - 自动创建本地端口转发，获取稳定访问地址（需Server Plugin）
5. **同步ComfyUI URL** - 自动提取访问地址并填入图像生成模块
6. **连接测试** - 验证ComfyUI服务可用性和响应状态

### 📊 可视化进度系统

- 6步流程进度列表，实时显示当前步骤和状态
- 动态图标：⏳ 进行中 / ✓ 完成 / ✗ 失败 / ⏭ 跳过
- 脉冲动画指示活跃步骤
- 实时日志面板（带时间戳和彩色级别标记）

### 🛡️ 完善的错误处理

- 每步失败时暂停流程并标记失败步骤
- 显示具体错误信息和解决建议
- 🔄 重试按钮：从失败步骤重新开始，跳过已完成步骤
- 详细流程日志，便于问题诊断

## 📦 安装方法

1. 打开 SillyTavern
2. 点击顶部扩展管理按钮 (📦)
3. 点击"安装第三方扩展"
4. 输入仓库地址:
   ```
   https://github.com/Feng-1994/sillytavern-image-assistant
   ```
5. 点击安装，等待完成
6. 刷新页面即可使用

> 💡 **安装即用：** 扩展安装后可直接使用所有CNB基础功能（Token验证、仓库管理、工作空间控制），无需额外配置。

## ⚙️ 配置说明

安装后，在扩展列表中找到"📷 图片功能辅助"：

1. **基本设置** - 启用扩展、自动处理标签、显示顶部导航栏图标
2. **生图风格** - 选择图片生成风格（动漫/写实/通用）
3. **模型配置** - 配置 ComfyUI 或 SD Web UI 连接
4. **AI提示词** - 配置AI大模型用于提示词增强
5. **CNB服务管理** - 配置CNB API Token、仓库路径，一键启动云ComfyUI

### ☁️ CNB ComfyUI 配置

1. 在 [cnb.cool](https://cnb.cool) 个人设置中创建访问令牌（需勾选workspace权限）
2. 填写API Token和仓库路径（格式：组织名/仓库名）
3. 点击 🚀 **一键启动** 按钮，自动完成全部流程
4. 流程完成后ComfyUI URL自动填入图像生成模块

### 🔧 可选：安装Server Plugin（SSH隧道功能）

SSH隧道等服务器端操作需要安装Server Plugin：

**自动安装：**
```bash
node public/scripts/extensions/third-party/sillytavern-image-assistant/install.mjs
```

**手动安装：**
1. 将扩展目录中的 `server-plugin/` 文件夹复制到 SillyTavern 的 `plugins/sillytavern-image-assistant/`
2. 在 `config.yaml` 中设置 `enableServerPlugins: true`
3. 重启 SillyTavern

> 💡 不安装Server Plugin不影响基础CNB功能的使用（Token验证、仓库管理、工作空间控制均可通过CORS代理正常使用）。

### 顶部导航栏图标

勾选"显示顶部导航栏图标"后，在顶部导航栏出现📷图标，点击即可打开与聊天框等宽的完整设置面板，无需在侧边栏滚动查找。

## 🔗 依赖

- SillyTavern 1.12.0+
- 图片生成后端（二选一）:
  - ComfyUI (推荐)
  - Stable Diffusion Web UI (自动检测)
- AI大模型（可选，用于提示词增强）:
  - OpenAI 兼容 API
  - Ollama
  - SillyTavern 内置 LLM
- CNB平台（可选，用于云ComfyUI）:
  - [CNB](https://cnb.cool) 账号和访问令牌
  - SSH客户端（用于隧道连接，需安装Server Plugin）

## 📝 版本历史

### v2.3.0

**🔒 安全修复 - 不再修改SillyTavern核心文件**

- 🛡️ **移除 `patchCorsProxy()`** - 不再直接修改SillyTavern核心文件 `corsProxy.js`，避免版本升级后产生兼容性问题
- 🛡️ **新增 `cleanupLegacyPatches()`** - 自动清理旧版安装脚本遗留的CORS代理补丁
- 🔍 **新增版本检测** - 自动检测SillyTavern版本，v1.17.0+无需补丁即可原生支持 `X-Target-Authorization`
- 🔧 **安全修改 `updateConfig()`** - 不再覆盖用户已有的配置值，仅在配置项缺失时追加
- ⚡ **优化认证模式检测** - 使用轻量级HEAD请求替代GET请求，减少API调用开销
- ⚡ **认证模式自动重试** - CORS代理请求遇到401/403时自动切换认证模式重试
- ⚡ **新增缓存失效机制** - 设置变更时自动重置认证缓存，确保下次请求使用正确模式

### v2.1.0

**🎯 安装即用 - 无需额外配置**

- ✨ 新增CORS代理模式：利用SillyTavern内置CORS代理 + `X-Target-Authorization`头安全转发CNB API Token
- ✨ 安装扩展后即可直接使用CNB基础功能，无需运行安装脚本
- ✨ Server Plugin降级为可选增强（仅SSH隧道等服务器端操作需要）
- 🔧 修复CORS代理查询参数丢失问题
- 🔧 修复"Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"错误
- 🔧 修复API Key输入框XSS防护不一致问题
- 🔧 优化错误提示：区分"CORS代理未启用"和"需要Server Plugin"两种场景

### v2.0.0

**🚀 重大更新 - CNB ComfyUI 一键启动**

- ✨ 新增6步自动化启动流程（Token验证→环境创建→状态监控→SSH隧道→URL同步→连接测试）
- ✨ 新增可视化步骤进度系统（实时状态图标、脉冲动画、子标题详情）
- ✨ 新增实时日志面板（时间戳、彩色级别、自动滚动）
- ✨ 新增错误处理与重试机制（失败暂停、建议提示、从失败步骤重试）
- ✨ 新增SSH隧道管理（自动建立、复用、关闭）
- ✨ 新增CNB ComfyUI代理端点（通过服务端代理访问ComfyUI API）
- ✨ 新增Workspace构建状态实时监控
- ✨ 新增自动保活和自动停止功能
- 🔧 修复CNB API调用缺少CSRF Token导致403错误
- 🔧 修复`localTunnelUrl`未传递导致SSH隧道无法复用
- 🔧 修复`cnbUpdateStatusUI`中`settings`未定义崩溃
- 🔧 修复后端隧道查找键不一致问题
- 💄 重新设计CNB配置UI（分区卡片布局、一键启动按钮）
- 💄 新增步骤进度、日志面板、重试按钮等CSS样式

### v1.0.0

- 重新生成按钮功能
- 顶部导航栏面板（与聊天框等宽）
- 侧边栏精简模式
- AI提示词增强（多模型支持）
- CNB ComfyUI自动唤醒
- 角色卡/世界书批量导出
- 交互式选择按钮

## 📄 许可证

MIT License
