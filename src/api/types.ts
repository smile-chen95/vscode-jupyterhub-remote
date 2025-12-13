/**
 * API 客户端基础类型定义
 */

export interface ApiConfig {
    /** JupyterHub 服务器 URL */
    baseUrl: string;
    /** API Token */
    token: string;
    /** 是否验证 SSL 证书 */
    verifySSL?: boolean;
    /** 请求超时时间（毫秒） */
    timeout?: number;
    /** 最大重试次数 */
    maxRetries?: number;
}

export interface ApiResponse<T = any> {
    status: number;
    data: T;
    headers: Record<string, string>;
}

export class ApiError extends Error {
    constructor(
        message: string,
        public status?: number,
        public response?: any,
        public cause?: any
    ) {
        super(message);
        this.name = 'ApiError';
    }
}
