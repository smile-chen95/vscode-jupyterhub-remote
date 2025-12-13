
import { HttpClient } from './client';

export interface ResourceLimit {
    rss: number;
    pss: number;
    warn: boolean;
}

export interface CpuLimit {
    cpu: number;
    warn: boolean;
}

export interface Limits {
    memory?: ResourceLimit;
    cpu?: CpuLimit;
}

export interface MetricsData {
    rss: number;
    pss: number;
    cpu_percent: number;
    cpu_count: number;
    limits: Limits;
}

export class MetricsApi {
    constructor(private client: HttpClient) { }

    async getMetrics(): Promise<MetricsData> {
        // 请求加入时间戳防止缓存
        const response = await this.client.get<MetricsData>(`/api/metrics/v1?_=${Date.now()}`);
        return response.data;
    }
}
