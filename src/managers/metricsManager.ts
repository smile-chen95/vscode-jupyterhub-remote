
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
        // 格式化内存大小
        const formatSize = (bytes: number) => {
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
            return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
        };

        const memUsed = formatSize(data.rss);
        let memLimitStr = '';

        // 如果有内存限制
        if (data.limits && data.limits.memory && data.limits.memory.rss) {
            const memLimit = formatSize(data.limits.memory.rss);
            memLimitStr = ` / ${memLimit}`;
        }

        const cpu = data.cpu_percent.toFixed(1);
        const cpuText = data.cpu_count ? `${cpu}% / ${data.cpu_count}c` : `${cpu}%`;

        let diskText = 'N/A';
        if (data.disk) {
            const diskUsed = formatSize(data.disk.used);
            diskText = data.disk.total ? `${diskUsed} / ${formatSize(data.disk.total)}` : diskUsed;
        }

        const memText = `${memUsed}${memLimitStr}`;

        // 状态栏文本
        this.statusBarItem.text = `$(pulse) CPU: ${cpuText}  $(server) Mem: ${memText}  $(database) Disk: ${diskText}`;

        // 悬停提示
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`### 服务器资源监控\n\n`);
        tooltip.appendMarkdown(`- **CPU 使用率**: ${data.cpu_percent}%\n`);
        tooltip.appendMarkdown(`- **CPU 核心数**: ${data.cpu_count}\n`);
        if (data.limits?.cpu) {
            tooltip.appendMarkdown(`- **CPU 限制**: ${data.limits.cpu.cpu}核\n`);
        }
        tooltip.appendMarkdown(`---\n`);
        tooltip.appendMarkdown(`- **内存使用 (RSS)**: ${formatSize(data.rss)}\n`);
        tooltip.appendMarkdown(`- **内存使用 (PSS)**: ${formatSize(data.pss)}\n`);
        if (data.limits?.memory) {
            tooltip.appendMarkdown(`- **内存限制 (RSS)**: ${formatSize(data.limits.memory.rss)}\n`);
            tooltip.appendMarkdown(`- **内存限制 (PSS)**: ${formatSize(data.limits.memory.pss)}\n`);
        }

        if (data.disk) {
            tooltip.appendMarkdown(`- **磁盘使用**: ${formatSize(data.disk.used)}`);
            if (data.disk.total) {
                tooltip.appendMarkdown(` / ${formatSize(data.disk.total)}`);
            }
            tooltip.appendMarkdown(`\n`);
        }

        this.statusBarItem.tooltip = tooltip;

        // 告警颜色
        const hasWarn = data.limits?.memory?.warn || data.limits?.cpu?.warn || data.limits?.disk?.warn || data.disk?.warn;
        if (hasWarn) {
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
