
import * as vscode from 'vscode';
import { MetricsApi, MetricsData } from '../api/metrics';
import { HttpClient } from '../api/client';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';

export class MetricsManager {
    private statusBarItem: vscode.StatusBarItem;
    private timer: NodeJS.Timeout | null = null;
    private api: MetricsApi | null = null;
    private isSupported: boolean = true;
    private consecutiveErrors: number = 0;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'jupyterhub.showMetricsDetails'; // 可选：点击显示详情
    }

    /**
     * 开始监控
     */
    start(httpClient: HttpClient) {
        this.stop();
        this.api = new MetricsApi(httpClient);
        this.isSupported = true;
        this.consecutiveErrors = 0;

        // 立即执行一次
        this.poll();

        // 启动轮询
        const interval = ConfigManager.getMetricsRefreshInterval();
        if (interval > 0) {
            this.timer = setInterval(() => this.poll(), interval * 1000);
        }
        this.statusBarItem.show();
    }

    /**
     * 停止监控
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.statusBarItem.hide();
        this.api = null;
    }

    /**
     * 轮询逻辑
     */
    private async poll() {
        if (!this.api || !this.isSupported) return;

        try {
            const data = await this.api.getMetrics();
            this.updateStatusBar(data);
            this.consecutiveErrors = 0;
        } catch (error: any) {
            // 如果是 404 (Not Found)，说明服务器没有安装此插件
            if (error.response?.status === 404) {
                Logger.log('Metrics API not supported by server, disabling monitoring.');
                this.isSupported = false;
                this.stop();
                return;
            }

            // 其他错误，允许重试几次
            this.consecutiveErrors++;
            Logger.warn(`Fetch metrics failed (${this.consecutiveErrors}):`, error.message);

            if (this.consecutiveErrors > 5) {
                // 连续失败多次，停止监控以防刷屏报错
                this.stop();
            }
        }
    }

    private updateStatusBar(data: MetricsData) {
        const formatBytes = (bytes: number) => {
            if (!Number.isFinite(bytes) || bytes < 0) return '-';
            const kib = 1024;
            const mib = kib * 1024;
            const gib = mib * 1024;
            const tib = gib * 1024;

            const trim = (value: string) => value.replace(/\.0$/, '');

            if (bytes < mib) return `${trim((bytes / kib).toFixed(1))}K`;
            if (bytes < gib) return `${trim((bytes / mib).toFixed(0))}M`;
            if (bytes < tib) return `${trim((bytes / gib).toFixed(1))}G`;
            return `${trim((bytes / tib).toFixed(1))}T`;
        };

        const formatCores = (cores: number) => {
            if (!Number.isFinite(cores) || cores < 0) return '-';
            return cores.toFixed(1).replace(/\.0$/, '');
        };

        const cpuTotal = data.cpu_count;
        const cpuUsedCores = (data.cpu_percent / 100) * cpuTotal;
        const cpuText = Number.isFinite(cpuTotal) && cpuTotal > 0
            ? `${formatCores(cpuUsedCores)}/${cpuTotal}`
            : `${data.cpu_percent.toFixed(1)}%`;

        const memUsed = formatBytes(data.rss);
        const memTotal = data.limits?.memory?.rss ? formatBytes(data.limits.memory.rss) : undefined;
        const memText = memTotal ? `${memUsed}/${memTotal}` : memUsed;

        const diskUsed = data.disk_used;
        const diskTotal = data.disk_total ?? data.limits?.disk?.disk;
        const diskText = (typeof diskUsed === 'number' && typeof diskTotal === 'number' && diskTotal > 0)
            ? `${formatBytes(diskUsed)}/${formatBytes(diskTotal)}`
            : (typeof diskUsed === 'number' ? formatBytes(diskUsed) : '');

        const parts: string[] = [];
        parts.push(`$(pulse) CPU: ${cpuText}`);
        parts.push(`$(server) Mem: ${memText}`);
        if (diskText) parts.push(`$(database) Disk: ${diskText}`);
        this.statusBarItem.text = parts.join('  ');

        // 悬停提示
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`### 服务器资源监控\n\n`);
        tooltip.appendMarkdown(`- **CPU 使用率**: ${data.cpu_percent}%\n`);
        tooltip.appendMarkdown(`- **CPU 使用核数(估算)**: ${formatCores(cpuUsedCores)} / ${cpuTotal}\n`);
        if (data.limits?.cpu?.cpu) tooltip.appendMarkdown(`- **CPU 限制**: ${data.limits.cpu.cpu}核\n`);
        tooltip.appendMarkdown(`---\n`);
        tooltip.appendMarkdown(`- **内存使用 (RSS)**: ${formatBytes(data.rss)}\n`);
        tooltip.appendMarkdown(`- **内存使用 (PSS)**: ${formatBytes(data.pss)}\n`);
        if (data.limits?.memory?.rss) tooltip.appendMarkdown(`- **内存总量/限制 (RSS)**: ${formatBytes(data.limits.memory.rss)}\n`);
        if (data.limits?.memory?.pss) tooltip.appendMarkdown(`- **内存总量/限制 (PSS)**: ${formatBytes(data.limits.memory.pss)}\n`);

        if (typeof diskUsed === 'number' || typeof diskTotal === 'number') {
            tooltip.appendMarkdown(`---\n`);
            if (typeof diskUsed === 'number') tooltip.appendMarkdown(`- **磁盘使用**: ${formatBytes(diskUsed)}\n`);
            if (typeof diskTotal === 'number') tooltip.appendMarkdown(`- **磁盘总量/限制**: ${formatBytes(diskTotal)}\n`);
        }

        this.statusBarItem.tooltip = tooltip;

        // 告警颜色
        if (data.limits?.memory?.warn || data.limits?.cpu?.warn || data.limits?.disk?.warn) {
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    dispose() {
        this.stop();
        this.statusBarItem.dispose();
    }
}
