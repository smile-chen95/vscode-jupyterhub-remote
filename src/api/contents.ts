/**
 * Jupyter Contents API 客户端
 * 文件系统操作接口
 */

import { HttpClient } from './client';

/**
 * 内容类型
 */
export type ContentType = 'directory' | 'file' | 'notebook';

/**
 * 内容格式
 */
export type ContentFormat = 'text' | 'base64' | 'json';

/**
 * 内容模型
 */
export interface ContentModel {
    name: string;
    path: string;
    type: ContentType;
    writable: boolean;
    created: string;
    last_modified: string;
    mimetype?: string;
    content?: any;
    format?: ContentFormat;
    size?: number;
}

export class ContentsApi {
    private client: HttpClient;
    private baseUrl: string;

    constructor(client: HttpClient, serverUrl: string) {
        this.client = client;
        this.baseUrl = serverUrl;
    }

    /**
     * 获取文件或目录内容
     */
    async get(path: string, includeContent: boolean = true): Promise<ContentModel> {
        const url = `/api/contents/${encodeURIComponent(path)}`;
        const params = includeContent ? {} : { content: '0' };

        const response = await this.client.get<ContentModel>(url, { params });
        return response.data;
    }

    /**
     * 获取文件内容（强制 text 格式，避免 jupytext 转换）
     */
    async getFile(path: string): Promise<ContentModel> {
        const url = `/api/contents/${encodeURIComponent(path)}`;
        // 强制指定 type=file, format=text, content=1
        const params = {
            type: 'file',
            format: 'text',
            content: '1'
        };

        const response = await this.client.get<ContentModel>(url, { params });
        return response.data;
    }

    /**
     * 列出目录内容
     */
    async listDirectory(path: string = ''): Promise<ContentModel[]> {
        const content = await this.get(path, true);

        if (content.type !== 'directory') {
            throw new Error(`路径 "${path}" 不是目录`);
        }

        return content.content || [];
    }

    /**
     * 创建新文件或目录
     */
    async create(path: string, type: ContentType, content?: any): Promise<ContentModel> {
        const url = `${this.baseUrl}/api/contents/${encodeURIComponent(path)}`;
        const data: any = { type };

        if (content !== undefined) {
            data.content = content;
            if (type === 'notebook') {
                data.format = 'json';
            } else if (typeof content === 'string') {
                data.format = 'text';
            }
        }

        const response = await this.client.post<ContentModel>(url, data);
        return response.data;
    }

    /**
     * 创建空 notebook
     */
    async createNotebook(path: string): Promise<ContentModel> {
        const emptyNotebook = {
            cells: [],
            metadata: {},
            nbformat: 4,
            nbformat_minor: 5
        };

        return await this.create(path, 'notebook', emptyNotebook);
    }

    /**
     * 更新文件内容
     */
    async save(path: string, content: any, format?: ContentFormat, type: ContentType = 'file'): Promise<ContentModel> {
        // url 中的 path 已经足够定位资源，但 body 中最好也带上
        const url = `/api/contents/${encodeURIComponent(path)}`;

        const data: any = {
            path,   // 添加 path
            type,   // 添加 type
            content
        };

        if (format) {
            data.format = format;
        }

        const response = await this.client.put<ContentModel>(url, data);
        return response.data;
    }

    /**
     * 删除文件或目录
     */
    async delete(path: string): Promise<void> {
        const url = `${this.baseUrl}/api/contents/${encodeURIComponent(path)}`;
        await this.client.delete(url);
    }

    /**
     * 重命名或移动文件
     */
    async rename(oldPath: string, newPath: string): Promise<ContentModel> {
        const url = `${this.baseUrl}/api/contents/${encodeURIComponent(oldPath)}`;
        const data = { path: newPath };

        const response = await this.client.patch<ContentModel>(url, data);
        return response.data;
    }

    /**
     * 上传文件
     */
    async uploadFile(path: string, content: string, format: ContentFormat = 'base64'): Promise<ContentModel> {
        return await this.create(path, 'file', content);
    }

    /**
     * 下载文件内容
     */
    async downloadFile(path: string, format: ContentFormat = 'text'): Promise<string> {
        const url = `${this.baseUrl}/api/contents/${encodeURIComponent(path)}`;
        const params = { format };

        const response = await this.client.get<ContentModel>(url, { params });
        return response.data.content;
    }

    /**
     * 创建目录
     */
    async createDirectory(path: string): Promise<ContentModel> {
        // 使用 PUT (save) 而不是 POST (create) 来创建指定名称的目录
        // POST 通常用于在目录下创建 "Untitled Folder"
        // PUT 用于在指定路径创建/更新资源
        return await this.save(path, null, 'json', 'directory');
    }

    /**
     * 检查路径是否存在
     */
    async exists(path: string): Promise<boolean> {
        try {
            await this.get(path, false);
            return true;
        } catch (error: any) {
            if (error.status === 404) {
                return false;
            }
            throw error;
        }
    }
}
