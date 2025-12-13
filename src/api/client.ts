/**
 * HTTP 客户端封装
 * 处理认证、重试和错误处理
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as https from 'https';
import { Readable } from 'stream';
import { ApiConfig, ApiError, ApiResponse } from './types';
import { Logger } from '../utils/logger';

export class HttpClient {
    private axios: AxiosInstance;
    private config: ApiConfig;
    private cookies: Map<string, string> = new Map(); // Store cookies manually

    constructor(config: ApiConfig) {
        this.config = {
            timeout: 30000,
            maxRetries: 3,
            verifySSL: true,
            ...config
        };

        this.axios = axios.create({
            baseURL: this.config.baseUrl,
            timeout: this.config.timeout,
            headers: {
                'Authorization': `token ${this.config.token}`,
                'Content-Type': 'application/json'
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: this.config.verifySSL
            }),
            withCredentials: true  // 启用 cookie 支持
        });

        // 添加请求拦截器
        this.axios.interceptors.request.use(
            async (config) => {
                // Add Cookie header manually
                if (this.cookies.size > 0) {
                    const cookieHeader = Array.from(this.cookies.entries())
                        .map(([key, value]) => `${key}=${value}`)
                        .join('; ');
                    config.headers['Cookie'] = cookieHeader;
                }
                return config;
            },
            error => Promise.reject(error)
        );

        // 添加响应拦截器
        this.axios.interceptors.response.use(
            response => {
                this.extractCookies(response);
                return response;
            },
            error => this.handleError(error)
        );
    }

    /**
     * Extract cookies from response
     */
    private extractCookies(response: AxiosResponse): void {
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
            const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
            cookies.forEach(cookieStr => {
                const parts = cookieStr.split(';');
                const cookiePair = parts[0].split('=');
                if (cookiePair.length >= 2) {
                    const key = cookiePair[0].trim();
                    const value = cookiePair[1].trim();
                    this.cookies.set(key, value);
                }
            });
        }
    }

    /**
     * 更新 Token
     */
    updateToken(token: string): void {
        this.config.token = token;
        this.axios.defaults.headers['Authorization'] = `token ${token}`;
    }

    /**
     * GET 请求
     */
    async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>('GET', url, undefined, config);
    }

    /**
     * GET 流式响应（用于 event-stream/progress）
     */
    async stream(url: string, config?: AxiosRequestConfig): Promise<Readable> {
        const response = await this.axios.get(url, {
            responseType: 'stream',
            ...config
        });
        return response.data as Readable;
    }

    /**
     * POST 请求
     */
    async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>('POST', url, data, config);
    }

    /**
     * PUT 请求
     */
    async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>('PUT', url, data, config);
    }

    /**
     * PATCH 请求
     */
    async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>('PATCH', url, data, config);
    }

    /**
     * DELETE 请求
     */
    async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
        return this.request<T>('DELETE', url, undefined, config);
    }

    /**
     * 通用请求方法，支持重试
     */
    private async request<T>(
        method: string,
        url: string,
        data?: any,
        config?: AxiosRequestConfig,
        retryCount = 0
    ): Promise<ApiResponse<T>> {
        // 打印请求日志
        Logger.log(`[API Request] ${method.toUpperCase()} ${url}`);
        if (data) {
            Logger.log('[API Request Body]:', JSON.stringify(data, null, 2));
        }

        try {
            const response: AxiosResponse<T> = await this.axios.request({
                method,
                url,
                data,
                ...config
            });

            // 打印响应日志
            Logger.log(`[API Response] ${response.status} ${response.statusText} (${url})`);
            // 避免打印过大的响应体 (例如文件内容)
            // 检查 Content-Type 是否为二进制流，或者响应体大小是否过大
            const contentType = response.headers['content-type'] as string | undefined;
            const isBinary = contentType?.includes('application/octet-stream') || contentType?.includes('image/') || contentType?.includes('audio/') || contentType?.includes('video/');

            if (!isBinary && JSON.stringify(response.data).length < 2000) {
                Logger.log('[API Response Body]:', JSON.stringify(response.data, null, 2));
            } else {
                Logger.log('[API Response Body]: [Large or Binary Content]');
            }

            return {
                status: response.status,
                data: response.data,
                headers: response.headers as Record<string, string>
            };
        } catch (error: any) {
            // 打印错误日志
            Logger.error(`[API Error] ${method.toUpperCase()} ${url}:`, error.message);
            if (error.response) {
                Logger.error('[API Error Response Status]:', error.response.status);
                Logger.error('[API Error Response Data]:', error.response.data);
            }

            // 如果还有重试次数，则重试
            if (retryCount < (this.config.maxRetries || 3) && this.shouldRetry(error)) {
                await this.delay(Math.pow(2, retryCount) * 1000); // 指数退避
                Logger.warn(`[API Retry] Retrying ${method.toUpperCase()} ${url} (attempt ${retryCount + 1}/${this.config.maxRetries})`);
                return this.request<T>(method, url, data, config, retryCount + 1);
            }
            throw error;
        }
    }

    /**
     * 判断是否应该重试
     */
    private shouldRetry(error: any): boolean {
        // 网络错误或 5xx 服务器错误应该重试
        if (!error.response) {
            return true; // 网络错误
        }
        const status = error.response.status;
        return status >= 500 && status < 600;
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 错误处理
     */
    private handleError(error: any): Promise<never> {
        if (error.response) {
            // 服务器返回了错误响应
            const message = error.response.data?.message || error.response.statusText;
            throw new ApiError(
                `API 错误: ${message}`,
                error.response.status,
                error.response.data,
                error
            );
        } else if (error.request) {
            // 请求已发送但没有收到响应
            const code = error.code || error.errno;
            const msg = error.message || error.cause?.message;
            const detailParts = [code, msg].filter(Boolean);
            const details = detailParts.length > 0 ? ` (${detailParts.join(': ')})` : '';
            Logger.error('[API Network Error Details]:', { code, message: msg });
            throw new ApiError(`网络错误：无法连接到服务器${details}`, undefined, undefined, error);
        } else {
            // 其他错误
            throw new ApiError(`请求错误: ${error.message}`, undefined, undefined, error);
        }
    }
}
