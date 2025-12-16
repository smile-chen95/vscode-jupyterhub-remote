/**
 * 配置管理工具
 */

import * as vscode from 'vscode';

export class ConfigManager {
    private static readonly CONFIG_SECTION = 'jupyterhub';

    /**
     * 获取服务器 URL
     */
    static getServerUrl(): string | undefined {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<string>('serverUrl');
    }

    /**
     * 设置服务器 URL
     */
    static async setServerUrl(url: string): Promise<void> {
        await vscode.workspace.getConfiguration(this.CONFIG_SECTION).update(
            'serverUrl',
            url,
            vscode.ConfigurationTarget.Global
        );
    }

    /**
     * 获取 SSL 验证设置
     */
    static getVerifySSL(): boolean {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<boolean>('verifySSL', true);
    }

    /**
     * 获取最大重试次数
     */
    static getMaxRetries(): number {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<number>('maxRetries', 3);
    }

    /**
     * 是否开启调试日志
     */
    static getDebug(): boolean {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<boolean>('debug', false);
    }

    /**
     * 是否自动启动用户服务器（默认开启）
     */
    static getAutoStartServer(): boolean {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<boolean>('autoStartServer', true);
    }

    /**
     * 获取每个服务器对应的默认 profile 配置
     */
    static getProfileByServer(): Record<string, string> {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<Record<string, string>>('profileByServer', {});
    }

    /**
     * 为指定服务器设置默认 profile
     */
    static async setProfileForServer(serverUrl: string, profile: string): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        const mapping = config.get<Record<string, string>>('profileByServer', {});
        mapping[serverUrl] = profile;
        await config.update('profileByServer', mapping, vscode.ConfigurationTarget.Global);
    }

    /**
     * 获取每个服务器对应的额外 user_options 配置（REST 启动透传）
     */
    static getUserOptionsByServer(): Record<string, Record<string, any>> {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<Record<string, Record<string, any>>>('userOptionsByServer', {});
    }

    /**
     * 获取文件列表刷新间隔（秒）
     */
    static getFileRefreshInterval(): number {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<number>('refreshInterval.files', 10);
    }

    /**
     * 获取内核列表刷新间隔（秒）
     */
    static getKernelRefreshInterval(): number {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<number>('refreshInterval.kernels', 10);
    }

    /**
     * 获取资源监控刷新间隔（秒）
     */
    static getMetricsRefreshInterval(): number {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<number>('refreshInterval.metrics', 5);
    }

    /**
     * 获取最近连接的服务器列表
     */
    static getRecentServers(): string[] {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<string[]>('recentServers', []);
    }

    static getAllowInsecureTokenStorage(): boolean {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<boolean>('allowInsecureTokenStorage', false);
    }

    static getTokenByServer(): Record<string, string> {
        return vscode.workspace.getConfiguration(this.CONFIG_SECTION).get<Record<string, string>>('tokenByServer', {});
    }

    static async setTokenForServer(serverUrl: string, token: string): Promise<void> {
        if (!serverUrl) return;
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        const mapping = config.get<Record<string, string>>('tokenByServer', {});
        mapping[serverUrl] = token;
        await config.update('tokenByServer', mapping, vscode.ConfigurationTarget.Global);
    }

    static async deleteTokenForServer(serverUrl: string): Promise<void> {
        if (!serverUrl) return;
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        const mapping = config.get<Record<string, string>>('tokenByServer', {});
        if (mapping && Object.prototype.hasOwnProperty.call(mapping, serverUrl)) {
            delete mapping[serverUrl];
            await config.update('tokenByServer', mapping, vscode.ConfigurationTarget.Global);
        }
    }

    /**
     * 添加到最近连接列表
     */
    static async addRecentServer(url: string): Promise<void> {
        if (!url) return;
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        let recent = config.get<string[]>('recentServers', []);

        // 移除已存在的（移到最前）
        recent = recent.filter(s => s !== url);
        recent.unshift(url);

        // 限制数量，比如 10 个
        if (recent.length > 10) {
            recent = recent.slice(0, 10);
        }

        await config.update('recentServers', recent, vscode.ConfigurationTarget.Global);
    }

    /**
     * 从最近连接列表移除
     */
    static async removeRecentServer(url: string): Promise<void> {
        if (!url) return;
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        const recent = config.get<string[]>('recentServers', []).filter(s => s !== url);
        await config.update('recentServers', recent, vscode.ConfigurationTarget.Global);
    }

    /**
     * 删除某个服务器相关的配置（profile/user_options）
     */
    static async deleteServerConfigs(serverUrl: string): Promise<void> {
        if (!serverUrl) return;

        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);

        const profileMapping = config.get<Record<string, string>>('profileByServer', {});
        if (profileMapping && Object.prototype.hasOwnProperty.call(profileMapping, serverUrl)) {
            delete profileMapping[serverUrl];
            await config.update('profileByServer', profileMapping, vscode.ConfigurationTarget.Global);
        }

        const userOptionsMapping = config.get<Record<string, Record<string, any>>>('userOptionsByServer', {});
        if (userOptionsMapping && Object.prototype.hasOwnProperty.call(userOptionsMapping, serverUrl)) {
            delete userOptionsMapping[serverUrl];
            await config.update('userOptionsByServer', userOptionsMapping, vscode.ConfigurationTarget.Global);
        }
    }
}
