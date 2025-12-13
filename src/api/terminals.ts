/**
 * Jupyter Terminals API 客户端
 * 终端管理接口
 */

import { HttpClient } from './client';

/**
 * 终端信息
 */
export interface TerminalInfo {
    name: string;
    last_activity?: string;
}

export type TerminalModel = TerminalInfo;

export class TerminalsApi {
    private client: HttpClient;
    private baseUrl: string;

    constructor(client: HttpClient, serverUrl: string) {
        this.client = client;
        this.baseUrl = serverUrl;
    }

    /**
     * 列出所有终端
     */
    async listTerminals(): Promise<TerminalInfo[]> {
        const url = `/api/terminals`;
        const response = await this.client.get<TerminalInfo[]>(url);
        return response.data;
    }

    /**
     * 创建新终端
     */
    async createTerminal(): Promise<TerminalInfo> {
        const url = `/api/terminals`;
        const response = await this.client.post<TerminalInfo>(url);
        return response.data;
    }

    /**
     * 获取终端信息
     */
    async getTerminal(terminalName: string): Promise<TerminalInfo> {
        const url = `/api/terminals/${terminalName}`;
        const response = await this.client.get<TerminalInfo>(url);
        return response.data;
    }

    /**
     * 删除终端
     */
    async deleteTerminal(terminalName: string): Promise<void> {
        const url = `/api/terminals/${terminalName}`;
        await this.client.delete(url);
    }

    /**
     * 获取终端 WebSocket URL
     */
    getTerminalWebSocketUrl(terminalName: string): string {
        // 将 http/https 替换为 ws/wss
        const wsUrl = this.baseUrl.replace(/^http/, 'ws');
        // 正确的路径格式：/terminals/websocket/{name}（注意：没有 /api/ 前缀）
        return `${wsUrl}/terminals/websocket/${terminalName}`;
    }
}
