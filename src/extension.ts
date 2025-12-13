/**
 * 插件入口
 */

import * as vscode from 'vscode';
import { JupyterHubApi } from './api/hub';
import { ContentsApi } from './api/contents';
import { KernelsApi } from './api/kernels';
import { TerminalsApi } from './api/terminals';
import { HttpClient } from './api/client';
import { FileTreeProvider } from './providers/fileTreeProvider';
import { KernelProvider } from './providers/kernelProvider';
import { ServerProvider } from './providers/serverProvider';
import { JupyterHubFileSystemProvider } from './providers/fileSystemProvider';
import { KernelControllerManager } from './providers/kernelControllerManager';
import { RemoteTerminal } from './terminal/remoteTerminal';
import { ConfigManager } from './utils/config';
import { Logger } from './utils/logger';
import { SecretStorageManager } from './utils/secretStorage';
import { MetricsManager } from './managers/metricsManager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// 全局状态
let hubApi: JupyterHubApi | null = null;
let contentsApi: ContentsApi | null = null;
let kernelsApi: KernelsApi | null = null;
let terminalsApi: TerminalsApi | null = null;
let currentUser: string | null = null;
let serverUrl: string | null = null;

// 视图提供者
let fileTreeProvider: FileTreeProvider;
let kernelProvider: KernelProvider;
let serverProvider: ServerProvider;
let fileSystemProvider: JupyterHubFileSystemProvider;
let kernelControllerManager: KernelControllerManager;

// Managers
let secretStorageManager: SecretStorageManager;
let metricsManager: MetricsManager;

// 终端管理
const terminalMap = new Map<string, vscode.Terminal>();

// 临时文件管理
const tempFilesMap = new Map<string, { remotePath: string, localPath: string }>();

/**
 * 插件激活
 */
export function activate(context: vscode.ExtensionContext) {
    Logger.log('JupyterHub Remote 插件已激活');

    // 初始化 Secret Storage
    secretStorageManager = new SecretStorageManager(context.secrets);

    // 初始化 Metrics Manager
    metricsManager = new MetricsManager();

    // 初始化视图提供者
    fileTreeProvider = new FileTreeProvider();
    kernelProvider = new KernelProvider();
    serverProvider = new ServerProvider();
    fileSystemProvider = new JupyterHubFileSystemProvider(null as any);
    kernelControllerManager = new KernelControllerManager();

    // 注册视图
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('jupyterhubFiles', fileTreeProvider)
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('jupyterhubKernels', kernelProvider)
    );
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('jupyterhubServers', serverProvider)
    );

    // 注册文件系统提供者
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('jupyterhub', fileSystemProvider, {
            isCaseSensitive: true
        })
    );

    // 注册 Metrics Manager
    context.subscriptions.push(metricsManager);

    // 监听文件保存事件
    vscode.workspace.onDidSaveTextDocument(handleFileSave);

    // 监听终端关闭事件
    vscode.window.onDidCloseTerminal((term) => {
        for (const [name, storedTerm] of terminalMap.entries()) {
            if (storedTerm === term) {
                terminalMap.delete(name);
                break;
            }
        }
    });

    // 注册命令
    registerCommands(context);

    // 尝试自动连接（如果有保存的配置）
    tryAutoConnect();
}

/**
 * 插件停用
 */
export function deactivate() {
    Logger.log('JupyterHub Remote 插件已停用');
    if (kernelControllerManager) {
        kernelControllerManager.dispose();
    }
    if (metricsManager) {
        metricsManager.dispose();
    }
}

/**
 * 注册所有命令
 */
function registerCommands(context: vscode.ExtensionContext) {
    // 连接管理命令
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.connectServer', connectServer)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.disconnectServer', disconnectServer)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.reconfigureServer', reconfigureServer)
    );

    // 文件操作命令
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.refreshFiles', () => fileTreeProvider.refresh())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.createFile', (item) => fileTreeProvider.createFile(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.createFolder', (item) => fileTreeProvider.createFolder(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.deleteItem', (item) => fileTreeProvider.deleteItem(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.renameItem', (item) => fileTreeProvider.renameItem(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.downloadFile', (item) => fileTreeProvider.downloadFile(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.uploadFile', (item) => fileTreeProvider.uploadFile(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.openFile', openFile)
    );

    // 终端命令
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.openTerminal', openTerminal)
    );

    // 内核命令
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.showKernels', () => kernelProvider.refresh())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.refreshKernels', () => kernelProvider.refresh())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.stopKernel', (item) => kernelProvider.stopKernel(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.restartKernel', (item) => kernelProvider.restartKernel(item))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.interruptKernel', (item) => kernelProvider.interruptKernel(item))
    );

    // 注册 Metrics 点击命令
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.showMetricsDetails', async () => {
            if (!metricsManager) return;
            vscode.window.showInformationMessage('正在刷新资源监控数据...');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyterhub.deleteTerminal', (item) => kernelProvider.deleteTerminal(item))
    );
}

/**
 * 尝试自动连接
 */
async function tryAutoConnect() {
    const savedServerUrl = ConfigManager.getServerUrl();

    // 尝试迁移旧 Token
    if (savedServerUrl) {
        await secretStorageManager.tryMigrateLegacyToken(savedServerUrl);
    }

    const hasToken = await secretStorageManager.hasToken(savedServerUrl);

    if (hasToken && savedServerUrl) {
        // 静默连接尝试，或者提示
        const shouldConnect = await vscode.window.showInformationMessage(
            `发现已保存的服务器配置: ${savedServerUrl}`,
            '连接',
            '忽略'
        );

        if (shouldConnect === '连接') {
            await connectServer();
        }
    }
}

/**
 * 连接到服务器
 * @param arg 可能是 URL 字符串，也可能是 TreeItem 对象 (点击视图条目时)
 */
async function connectServer(arg?: any) {
    try {
        Logger.log('[Connect] Triggered. Arg type:', typeof arg);

        // 1. 解析目标 URL
        let targetUrl: string | undefined;

        if (typeof arg === 'string') {
            targetUrl = arg;
        } else if (arg && typeof arg === 'object') {
            if (arg.command?.arguments?.[0]) {
                targetUrl = arg.command.arguments[0];
            } else if (typeof arg.label === 'string' && (arg.label.startsWith('http') || arg.label === 'New Connection')) {
                targetUrl = arg.label;
            }
        }

        if (targetUrl === '__new__') {
            targetUrl = undefined;
        }

        Logger.log(`[Connect] Resolved targetUrl: ${targetUrl}`);

        // 2. 获取当前配置并进行从错误中恢复
        let currentConfigUrl = ConfigManager.getServerUrl();
        if (typeof currentConfigUrl !== 'string') {
            Logger.warn('[Connect] Config corruption detected. Resetting serverUrl.');
            currentConfigUrl = '';
            await ConfigManager.setServerUrl('');
        }

        // 3. 智能判断
        if (hubApi && targetUrl && currentConfigUrl === targetUrl) {
            vscode.window.showInformationMessage(`已连接到 ${targetUrl}`);
            return;
        }

        // 热切换：先停止监控
        metricsManager.stop();
        await vscode.commands.executeCommand('setContext', 'jupyterhub.connected', false);

        // 4. 确定最终 URL
        let url = targetUrl;
        if (!url) {
            if (currentConfigUrl && !arg) {
                url = currentConfigUrl;
            }
        }

        // 5. 如果还是没有，提示输入
        if (!url) {
            url = await vscode.window.showInputBox({
                prompt: '输入 JupyterHub 服务器 URL',
                placeHolder: 'https://hub.example.com',
                validateInput: (value) => {
                    if (!value) return 'URL 不能为空';
                    if (!value.startsWith('http://') && !value.startsWith('https://')) {
                        return 'URL 必须以 http:// 或 https:// 开头';
                    }
                    return null;
                }
            });

            if (!url) return;
        }

        // 规范化 URL
        if (url.endsWith('/')) {
            url = url.slice(0, -1);
        }
        Logger.log(`[Connect] Final url to connect: ${url}`);

        // 6. 保存配置
        await ConfigManager.setServerUrl(url);

        // 7. 获取 Token
        let token = await secretStorageManager.getToken(url);

        Logger.log(`[Connect] Token lookup for ${url}: ${token ? 'FOUND' : 'NOT FOUND'}`);

        if (!token) {
            token = await vscode.window.showInputBox({
                prompt: `输入 ${url} 的 API Token`,
                password: true,
                validateInput: (value) => value ? null : 'Token 不能为空'
            });

            if (!token) return;

            // 保存 Token
            await secretStorageManager.saveToken(token, url);
        }

        // 8. 建立连接 (包含重试逻辑)
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `正在连接到 ${url}...`,
            cancellable: false
        }, async (progress) => {
            let retryWithNewToken = false;

            do {
                try {
                    retryWithNewToken = false; // 重置标志

                    // 创建 Hub API 客户端
                    hubApi = new JupyterHubApi({
                        baseUrl: url!,
                        token: token!,
                        verifySSL: ConfigManager.getVerifySSL(),
                        maxRetries: ConfigManager.getMaxRetries()
                    });

                    progress.report({ increment: 20, message: '验证身份...' });

                    // 关键点：这里进行第一次请求，如果 Token 错误会抛出异常
                    const user = await hubApi.getCurrentUser();
                    currentUser = user.name;

                    // 确保服务器已启动
                    progress.report({ increment: 10, message: '检查服务器状态...' });
                    // 目前所有环境都使用默认 server（REST: /hub/api/users/{user}/server）
                    const status = await hubApi.getServerStatus(currentUser, '');

                    if (!status?.ready) {
                        if (!ConfigManager.getAutoStartServer()) {
                            throw new Error('用户服务器未运行，且已关闭自动启动。请在浏览器中手动启动后重试连接。或在设置里面启用自动启动服务');
                        }

                        const userOptionsByServer = ConfigManager.getUserOptionsByServer();
                        let userOptions: Record<string, any> = {
                            ...(userOptionsByServer[url!] || {})
                        };
                        const profileByServer = ConfigManager.getProfileByServer();
                        let profile: string | undefined = profileByServer[url!];

                        if (!profile) {
                            const input = await vscode.window.showInputBox({
                                prompt: `请输入 ${url} 的 profile key（可留空，使用默认资源）`,
                                placeHolder: 'profile key（可选）',
                                ignoreFocusOut: true
                            });
                            if (input === undefined) {
                                throw new Error('用户取消输入 profile');
                            }
                            profile = input.trim();
                            if (profile) {
                                await ConfigManager.setProfileForServer(url!, profile);
                            }
                        }

                        if (profile && userOptions.profile === undefined) {
                            userOptions.profile = profile;
                        }

                        progress.report({ increment: 5, message: '启动服务器...' });
                        await hubApi.startServer(currentUser, '', userOptions);

                        // 使用 progress 事件流更新启动进度
                        await hubApi.waitForServerWithProgress(currentUser, '', (p, msg) => {
                            const text = msg ? `服务器启动中 ${p}% - ${msg}` : `服务器启动中 ${p}%`;
                            progress.report({ message: text });
                        });
                    }

                    // 如果成功，继续后续流程...
                    progress.report({ increment: 10, message: '定位服务器...' });
                    serverUrl = hubApi.getUserServerUrl(currentUser, '');

                    const httpClient = new HttpClient({
                        baseUrl: serverUrl,
                        token: token!,
                        verifySSL: ConfigManager.getVerifySSL(),
                        maxRetries: ConfigManager.getMaxRetries()
                    });

                    contentsApi = new ContentsApi(httpClient, serverUrl);
                    kernelsApi = new KernelsApi(httpClient, serverUrl);
                    terminalsApi = new TerminalsApi(httpClient, serverUrl);

                    // 更新视图组件
                    fileTreeProvider.setContentsApi(contentsApi);
                    kernelProvider.setApis(kernelsApi, terminalsApi);
                    serverProvider.setHubApi(hubApi!);
                    fileSystemProvider.setContentsApi(contentsApi);

                    // 注册 Controller
                    await kernelControllerManager.refreshControllers(kernelsApi, serverUrl, token!);

                    // 启动监控
                    metricsManager.start(httpClient);

                    // 设置上下文已连接
                    await vscode.commands.executeCommand('setContext', 'jupyterhub.connected', true);

                    // 加入最近列表
                    await ConfigManager.addRecentServer(url!);

                } catch (error: any) {
                    // 检查是否是 403 认证错误
                    const isForbidden = error.message.includes('403') || error.message.includes('Forbidden') || (error.response && error.response.status === 403);

                    if (isForbidden) {
                            Logger.log(`[Connect] 403 Forbidden detected for ${url}. Token might be invalid.`);

                        // 移除无效 Token
                        await secretStorageManager.deleteToken(url);

                        // 询问用户是否重新输入
                        const result = await vscode.window.showWarningMessage(
                            `登录失败: 403 Forbidden。存储的 Token 可能已过期或不匹配。`,
                            '输入新 Token',
                            '取消'
                        );

                        if (result === '输入新 Token') {
                            const newToken = await vscode.window.showInputBox({
                                prompt: `请重新输入 ${url} 的 API Token`,
                                password: true,
                                validateInput: (value) => value ? null : 'Token 不能为空'
                            });

                            if (newToken) {
                                token = newToken;
                                // 保存新 Token
                                await secretStorageManager.saveToken(token, url);
                                retryWithNewToken = true; // 触发重试循环
                                continue; // 重新开始 do-while
                            }
                        }
                    }

                    // 如果不是 403 或者用户取消，则抛出原始错误
                    throw error;
                }
            } while (retryWithNewToken);
        });

        // showInformationMessage 不会自动关闭，这里用状态栏提示并自动消失
        vscode.window.setStatusBarMessage(`已连接: ${currentUser} @ ${url}`, 3000);

    } catch (error: any) {
        Logger.error(error);
        vscode.window.showErrorMessage(`连接失败: ${error.message}`);
        await disconnectServer();
    }
}

/**
 * 断开服务器连接
 */
async function disconnectServer() {
    hubApi = null;
    contentsApi = null;
    kernelsApi = null;
    terminalsApi = null;
    currentUser = null;
    // serverUrl = null; // 保留 serverUrl 以便 Config 使用，或者不需要

    // 停止监控
    metricsManager.stop();

    fileTreeProvider.clearContentsApi();
    kernelProvider.clearApis();
    serverProvider.setHubApi(null as any);
    fileSystemProvider.setContentsApi(null as any);

    if (kernelControllerManager) {
        kernelControllerManager.dispose();
    }

    // 设置连接上下文状态
    await vscode.commands.executeCommand('setContext', 'jupyterhub.connected', false);

    vscode.window.showInformationMessage('已断开连接');
}

/**
 * 重新配置服务器（强制重新输入）
 */
async function reconfigureServer() {
    // 1. 先保存当前的 URL，否则断开/清空后就找不到了
    const currentUrl = ConfigManager.getServerUrl();

    // 2. 断开连接
    await disconnectServer();

    // 3. 删除特定 URL 的 Token (关键修复)
    // 如果不删这个，下次输入相同 URL 时又会自动读取旧 Token
    if (currentUrl) {
        // 尝试删除标准格式
        await secretStorageManager.deleteToken(currentUrl);
        // 同时也尝试删除一下去尾部斜杠的，以防万一
        if (currentUrl.endsWith('/')) {
            await secretStorageManager.deleteToken(currentUrl.slice(0, -1));
        } else {
            await secretStorageManager.deleteToken(currentUrl + '/');
        }
    }

    // 同时也删除默认 Token，确保彻底
    await secretStorageManager.deleteToken();

    // 4. 清除最后一次连接的记录
    await ConfigManager.setServerUrl('');

    // 延迟一下确保清除完成
    await new Promise(resolve => setTimeout(resolve, 500));

    // 5. 强制重新连接（此时因为 Token 已删，输入 URL 后必会提示输入 Token）
    await connectServer();
}

/**
 * 保存文件回调
 */
async function handleFileSave(document: vscode.TextDocument) {
    if (!contentsApi) return;

    const localPath = document.uri.fsPath;
    // 查找是否是受管理的临时文件
    for (const [key, info] of tempFilesMap.entries()) {
        if (info.localPath === localPath) {
            try {
                const content = fs.readFileSync(localPath, 'utf-8');
                Logger.log(`Syncing ${info.remotePath} back to server...`);
                // 显式指定 format 为 'text'
                await contentsApi.save(info.remotePath, content, 'text');
                vscode.window.setStatusBarMessage(`已同步 ${info.remotePath}`, 3000);
            } catch (error: any) {
                vscode.window.showErrorMessage(`同步失败: ${error.message}`);
            }
            break;
        }
    }
}

/**
 * 打开远程文件（本地编辑模式）
 */
async function openFile(item: any) {
    if (!contentsApi) {
        vscode.window.showErrorMessage('未连接到服务器');
        return;
    }

    try {
        const filePath = item.model.path;
        const fileName = path.basename(filePath);

        if (fileName.endsWith('.ipynb')) {
            const uri = vscode.Uri.from({
                scheme: 'jupyterhub',
                path: '/' + filePath
            });
            await vscode.commands.executeCommand('vscode.open', uri);
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `正在打开 ${fileName}...`,
            cancellable: false
        }, async () => {
            const model = await contentsApi!.getFile(filePath);

            const tempDir = path.join(os.tmpdir(), 'vscode-jupyterhub-edit');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const localPath = path.join(tempDir, fileName);

            let contentToWrite = model.content;
            if (typeof contentToWrite !== 'string') {
                contentToWrite = JSON.stringify(contentToWrite, null, 2);
            }
            fs.writeFileSync(localPath, contentToWrite);

            tempFilesMap.set(localPath, { remotePath: filePath, localPath });

            const doc = await vscode.workspace.openTextDocument(localPath);
            await vscode.window.showTextDocument(doc);
        });

    } catch (error: any) {
        vscode.window.showErrorMessage(`打开文件失败: ${error.message}`);
    }
}

/**
 * 打开远程终端
 */
async function openTerminal(item?: any) {
    if (!terminalsApi) {
        vscode.window.showErrorMessage('未连接到服务器');
        return;
    }

    try {
        let terminalName: string;

        if (item && item.contextValue === 'terminal') {
            terminalName = item.data.name;
        } else {
            const terminal = await terminalsApi.createTerminal();
            terminalName = terminal.name;
        }

        if (terminalMap.has(terminalName)) {
            const existingTerm = terminalMap.get(terminalName);
            if (existingTerm && !existingTerm.exitStatus) {
                existingTerm.show();
                return;
            }
            terminalMap.delete(terminalName);
        }

        const wsUrl = terminalsApi.getTerminalWebSocketUrl(terminalName);
        // 这里需要正确的 URL 来获取 token
        // 由于 serverUrl 是 hubApi.getUserServerUrl 计算出来的，可能不准。
        // 但我们存储 token 是基于 hub url。
        // 所以我们应该传入 hub url。但在 connectServer 里我们知道。这里需要保存一下 hubUrl。
        // 简单处理：使用 setServerUrl 保存的那个。
        const hubUrl = ConfigManager.getServerUrl();
        const token = await secretStorageManager.getToken(hubUrl);

        if (!token) {
            vscode.window.showErrorMessage('未找到 Token');
            return;
        }

        const pty = new RemoteTerminal(wsUrl, token, terminalName);
        const vscodeTerminal = vscode.window.createTerminal({
            name: `JupyterHub Terminal (${terminalName})`,
            pty
        });

        terminalMap.set(terminalName, vscodeTerminal);

        vscodeTerminal.show();

    } catch (error: any) {
        vscode.window.showErrorMessage(`打开终端失败: ${error.message}`);
    }
}
