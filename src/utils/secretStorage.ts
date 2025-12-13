/**
 * 安全存储管理（用于存储 Token）
 */

import * as vscode from 'vscode';
import { Logger } from './logger';

export class SecretStorageManager {
    private static readonly TOKEN_KEY = 'jupyterhub.token';

    constructor(private secretStorage: vscode.SecretStorage) { }

    /**
     * 保存 Token (支持多服务器)
     */
    async saveToken(token: string, url?: string): Promise<void> {
        // 保存默认 token (为了向后兼容)
        await this.secretStorage.store(SecretStorageManager.TOKEN_KEY, token);

        // 如果提供了 url，保存特定 url 的 token
        if (url) {
            const key = `jupyterhub.token.${url}`;
            await this.secretStorage.store(key, token);
        }
    }

    /**
     * 获取 Token
     */
    async getToken(url?: string): Promise<string | undefined> {
        if (url) {
            const key = `jupyterhub.token.${url}`;
            return await this.secretStorage.get(key);
        }
        return await this.secretStorage.get(SecretStorageManager.TOKEN_KEY);
    }

    /**
     * 尝试迁移旧的 Token 到新的 URL 格式
     */
    async tryMigrateLegacyToken(url: string): Promise<void> {
        if (!url) return;

        // 检查新格式是否存在
        const newKey = `jupyterhub.token.${url}`;
        const newToken = await this.secretStorage.get(newKey);

        // 如果新格式不存在，但有旧格式
        if (!newToken) {
            const legacyToken = await this.secretStorage.get(SecretStorageManager.TOKEN_KEY);
            if (legacyToken) {
                Logger.log(`Migrating legacy token for ${url}`);
                await this.secretStorage.store(newKey, legacyToken);
            }
        }
    }

    /**
     * 删除 Token
     */
    async deleteToken(url?: string): Promise<void> {
        // 如果指定了 URL，只删除那个 URL 的
        if (url) {
            const key = `jupyterhub.token.${url}`;
            await this.secretStorage.delete(key);
        } else {
            // 否则删除默认的
            await this.secretStorage.delete(SecretStorageManager.TOKEN_KEY);
        }
    }

    /**
     * 检查是否有保存的 Token
     */
    async hasToken(url?: string): Promise<boolean> {
        const token = await this.getToken(url);
        return !!token;
    }
}
