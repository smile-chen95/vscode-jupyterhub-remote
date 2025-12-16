/**
 * JupyterHub API 客户端
 * 提供 JupyterHub 特定的 API 接口
 */

import { HttpClient } from './client';
import { ApiConfig } from './types';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';

/**
 * 用户信息
 */
export interface UserInfo {
    name: string;
    admin: boolean;
    groups: string[];
    server?: string;
    pending?: string | null;
    created?: string;
    last_activity?: string;
    servers?: Record<string, ServerInfo>;
}

/**
 * 服务器信息
 */
export interface ServerInfo {
    name: string;
    ready: boolean;
    pending?: string | null;
    url: string;
    user_options?: Record<string, any>;
    progress_url?: string;
}

/**
 * Hub 信息
 */
export interface HubInfo {
    version: string;
    authenticator?: {
        class: string;
        version?: string;
    };
    spawner?: {
        class: string;
        version?: string;
    };
}

export class JupyterHubApi {
    private client: HttpClient;
    private baseUrl: string;

    constructor(config: ApiConfig) {
        this.client = new HttpClient(config);
        this.baseUrl = config.baseUrl;
    }

    /**
     * 更新 Token
     */
    updateToken(token: string): void {
        this.client.updateToken(token);
    }

    /**
     * 获取 Hub 信息（用于验证连接）
     */
    async getHubInfo(): Promise<HubInfo> {
        const response = await this.client.get<HubInfo>('/hub/api/');
        return response.data;
    }

    /**
     * 获取当前用户信息
     */
    async getCurrentUser(): Promise<UserInfo> {
        const response = await this.client.get<UserInfo>('/hub/api/user');
        return response.data;
    }

    /**
     * 获取指定用户信息
     */
    async getUser(username: string): Promise<UserInfo> {
        const response = await this.client.get<UserInfo>(`/hub/api/users/${username}`);
        return response.data;
    }

    /**
     * 列出用户（管理员权限）
     */
    async listUsers(offset: number = 0, limit: number = 200): Promise<UserInfo[]> {
        const response = await this.client.get<UserInfo[]>('/hub/api/users', {
            params: { offset, limit }
        });
        return response.data;
    }

    async listAllUsers(): Promise<UserInfo[]> {
        const limit = 200;
        let offset = 0;
        const users: UserInfo[] = [];

        while (true) {
            const batch = await this.listUsers(offset, limit);
            users.push(...batch);
            if (batch.length < limit) {
                break;
            }
            offset += limit;
        }

        return users;
    }

    /**
     * 启动用户服务器
     */
    async startServer(
        username: string,
        _serverName: string = '',
        userOptions: Record<string, any> = {}
    ): Promise<void> {
        Logger.log(`[JupyterHub] Preparing to start server: ${username} (default server only)`);
        const apiSpawnUrl = `/hub/api/users/${username}/server`;

        Logger.log('[JupyterHub] Spawning via REST API...');
        await this.client.post(apiSpawnUrl, userOptions);
        Logger.log('[JupyterHub] REST API spawn request sent');
    }

    private async watchServerProgress(
        progressUrl: string,
        onProgress: (progress: number, message?: string) => void,
        shouldStop: () => boolean
    ): Promise<void> {
        try {
            const stream = await this.client.stream(progressUrl, {
                headers: { Accept: 'text/event-stream' }
            });

            let buffer = '';
            stream.on('data', (chunk: Buffer) => {
                if (shouldStop()) {
                    stream.destroy();
                    return;
                }
                buffer += chunk.toString('utf8');
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';

                for (const part of parts) {
                    const line = part.split('\n').find(l => l.startsWith('data:'));
                    if (!line) continue;
                    const jsonStr = line.replace(/^data:\s*/, '').trim();
                    if (!jsonStr) continue;
                    try {
                        const ev = JSON.parse(jsonStr);
                        if (typeof ev.progress === 'number') {
                            onProgress(ev.progress, ev.message || ev.html_message);
                        }
                        if (ev.ready) {
                            stream.destroy();
                        }
                    } catch {
                        // ignore parse errors
                    }
                }
            });

            stream.on('error', () => {
                stream.destroy();
            });
        } catch {
            // ignore progress errors
        }
    }

    /**
     * 等待服务器就绪（同时监听 progress 事件流）
     */
    async waitForServerWithProgress(
        username: string,
        serverName: string = '',
        onProgress?: (progress: number, message?: string) => void,
        timeout: number = 300000,
        pollInterval: number = 2000
    ): Promise<ServerInfo> {
        let stopped = false;
        if (onProgress) {
            const progressUrl = `/hub/api/users/${username}/server/progress`;
            this.watchServerProgress(progressUrl, onProgress, () => stopped);
        }
        try {
            return await this.waitForServer(username, serverName, timeout, pollInterval);
        } finally {
            stopped = true;
        }
    }

    /**
     * 停止用户服务器
     */
    async stopServer(username: string, serverName: string = ''): Promise<void> {
        const url = serverName
            ? `/hub/api/users/${username}/servers/${serverName}`
            : `/hub/api/users/${username}/server`;

        await this.client.delete(url);
    }

    /**
     * 获取用户服务器状态
     */
    async getServerStatus(username: string, serverName: string = ''): Promise<ServerInfo | null> {
        try {
            const user = await this.getUser(username);

            if (serverName) {
                return user.servers?.[serverName] || null;
            } else {
                // JupyterHub 不同版本/配置下默认服务器位置不同：
                // - 旧版本常在 user.servers['']
                // - 新版本可能在 user.servers['default']
                // - 也可能直接在 user.server（但此 repo 的 UserInfo.server 类型未建模为对象）
                const rawDefaultServer = (user as any).server;
                const defaultServer =
                    rawDefaultServer && typeof rawDefaultServer === 'object'
                        ? (rawDefaultServer as ServerInfo)
                        : null;
                return defaultServer || user.servers?.[''] || user.servers?.['default'] || null;
            }
        } catch (error) {
            return null;
        }
    }

    /**
     * 等待服务器就绪
     */
    async waitForServer(
        username: string,
        serverName: string = '',
        timeout: number = 300000, // 5分钟
        pollInterval: number = 2000 // 2秒
    ): Promise<ServerInfo> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const status = await this.getServerStatus(username, serverName);

            if (status?.ready) {
                return status;
            }

            if (status?.pending === null) {
                throw new Error('服务器启动失败');
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        throw new Error('等待服务器就绪超时');
    }

    /**
     * 获取用户服务器 URL
     */
    getUserServerUrl(username: string, serverName: string = ''): string {
        const serverPath = serverName ? `/user/${username}/${serverName}` : `/user/${username}`;
        return `${this.baseUrl}${serverPath}`;
    }

    /**
     * 确保服务器运行（如果未运行则启动）
     */
    async ensureServerRunning(
        username: string,
        serverName: string = '',
        userOptions: Record<string, any> = {}
    ): Promise<ServerInfo> {
        Logger.log('[JupyterHub] 检查服务器状态...');
        const status = await this.getServerStatus(username, serverName);

        Logger.log('[JupyterHub] 服务器状态:', JSON.stringify(status));

        if (status?.ready) {
            Logger.log('[JupyterHub] 服务器已就绪，无需启动');
            return status;
        }

        // 如果关闭了自动启动，则直接提示用户手动启动
        if (!ConfigManager.getAutoStartServer()) {
            throw new Error('用户服务器未运行，且已关闭自动启动。请在浏览器中手动启动后重试连接。或在设置里面启用自动启动服务');
        }

        if (!status || status.pending === null) {
            // 服务器未运行或启动失败，启动服务器
            Logger.log('[JupyterHub] 服务器未运行，准备启动...');
            await this.startServer(username, serverName, userOptions);
        } else {
            Logger.log('[JupyterHub] 服务器正在启动中，等待就绪...');
        }

        // 等待服务器就绪
        Logger.log('[JupyterHub] 等待服务器就绪...');
        return await this.waitForServer(username, serverName);
    }
}
