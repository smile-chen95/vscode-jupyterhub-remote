/**
 * Jupyter Kernels API 客户端
 * 内核管理接口
 */

import { HttpClient } from './client';
import { Logger } from '../utils/logger';

/**
 * 内核规格
 */
export interface KernelSpec {
    name: string;
    spec: {
        language: string;
        display_name: string;
        argv: string[];
        env?: Record<string, string>;
    };
    resources: Record<string, any>;
}

/**
 * 内核信息
 */
export interface KernelInfo {
    id: string;
    name: string;
    last_activity: string;
    execution_state: 'idle' | 'busy' | 'starting';
    connections: number;
}

/**
 * 会话模型
 */
export interface SessionModel {
    id: string;
    path: string;
    name: string;
    type: string;
    kernel: KernelInfo;
    notebook: {
        path: string;
        name: string;
    };
}

/**
 * 内核规格列表
 */
export interface KernelSpecList {
    default: string;
    kernelspecs: Record<string, KernelSpec>;
}

export class KernelsApi {
    private client: HttpClient;
    private baseUrl: string;

    constructor(client: HttpClient, serverUrl: string) {
        this.client = client;
        this.baseUrl = serverUrl;
    }

    /**
     * 获取所有可用的内核规格
     */
    async getKernelSpecs(): Promise<KernelSpecList> {
        const url = `${this.baseUrl}/api/kernelspecs`;
        Logger.log('[KernelsApi] Fetching kernel specs from', url);
        const response = await this.client.get<KernelSpecList>(url);
        return response.data;
    }

    /**
     * 获取指定内核规格
     */
    async getKernelSpec(kernelName: string): Promise<KernelSpec> {
        const url = `${this.baseUrl}/api/kernelspecs/${kernelName}`;
        const response = await this.client.get<KernelSpec>(url);
        return response.data;
    }

    /**
     * 列出所有运行中的内核
     */
    async listKernels(): Promise<KernelInfo[]> {
        const url = `${this.baseUrl}/api/kernels`;
        const response = await this.client.get<KernelInfo[]>(url);
        return response.data;
    }

    /**
     * 列出所有活动会话
     */
    async listSessions(): Promise<SessionModel[]> {
        const url = `${this.baseUrl}/api/sessions`;
        const response = await this.client.get<SessionModel[]>(url);
        return response.data;
    }

    /**
     * 创建或获取会话
     */
    async createSession(notebookPath: string, kernelName: string): Promise<SessionModel> {
        const url = `${this.baseUrl}/api/sessions`;
        const data = {
            session: {
                path: notebookPath,
                type: 'notebook',
                name: notebookPath.split('/').pop() || notebookPath,
                kernel: {
                    name: kernelName
                }
            }
        };

        // 如果会话已存在，API 会返回现有会话；否则创建新的
        const response = await this.client.post<SessionModel>(url, data);
        return response.data;
    }

    /**
     * 启动新内核
     */
    async startKernel(kernelName?: string, path?: string): Promise<KernelInfo> {
        const url = `${this.baseUrl}/api/kernels`;
        const data: any = {};

        if (kernelName) {
            data.name = kernelName;
        }
        if (path) {
            data.path = path;
        }

        const response = await this.client.post<KernelInfo>(url, data);
        return response.data;
    }

    /**
     * 获取内核信息
     */
    async getKernel(kernelId: string): Promise<KernelInfo> {
        const url = `${this.baseUrl}/api/kernels/${kernelId}`;
        const response = await this.client.get<KernelInfo>(url);
        return response.data;
    }

    /**
     * 停止内核
     */
    async stopKernel(kernelId: string): Promise<void> {
        const url = `${this.baseUrl}/api/kernels/${kernelId}`;
        await this.client.delete(url);
    }

    /**
     * 重启内核
     */
    async restartKernel(kernelId: string): Promise<KernelInfo> {
        const url = `${this.baseUrl}/api/kernels/${kernelId}/restart`;
        const response = await this.client.post<KernelInfo>(url);
        return response.data;
    }

    /**
     * 中断内核
     */
    async interruptKernel(kernelId: string): Promise<void> {
        const url = `${this.baseUrl}/api/kernels/${kernelId}/interrupt`;
        await this.client.post(url);
    }
}
