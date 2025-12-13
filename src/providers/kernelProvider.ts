/**
 * 内核提供者
 * 显示内核规格和运行中的内核、会话、终端
 */

import * as vscode from 'vscode';
import { KernelsApi, KernelSpec, KernelInfo, SessionModel } from '../api/kernels';
import { TerminalsApi, TerminalModel } from '../api/terminals';
import { ConfigManager } from '../utils/config';

export class KernelTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly data?: KernelSpec | KernelInfo | SessionModel | TerminalModel
    ) {
        super(label, collapsibleState);

        // 设置图标
        if (contextValue === 'category') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (contextValue === 'kernelspec') {
            this.iconPath = new vscode.ThemeIcon('server-process');
        } else if (contextValue === 'kernel') {
            // Kernel inside session or standalone
            const kernel = data as KernelInfo;
            this.setKernelIcon(kernel);
        } else if (contextValue === 'session') {
            const session = data as SessionModel;
            this.iconPath = new vscode.ThemeIcon('notebook');
            if (session.kernel) {
                this.description = `(${session.kernel.name}) - ${session.kernel.execution_state}`;
            }
        } else if (contextValue === 'terminal') {
            this.iconPath = new vscode.ThemeIcon('terminal');
            const term = data as TerminalModel;
            // Terminals don't usually report state, just existence
            this.description = 'Running';
            // 绑定点击命令
            this.command = {
                command: 'jupyterhub.openTerminal',
                title: 'Open Terminal',
                arguments: [this] // 传入当前 item，以便 openTerminal 函数获取 name
            };
        }
    }

    private setKernelIcon(kernel: KernelInfo) {
        if (kernel.execution_state === 'busy') {
            this.iconPath = new vscode.ThemeIcon('loading~spin');
        } else if (kernel.execution_state === 'idle') {
            this.iconPath = new vscode.ThemeIcon('check');
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
    }
}

export class KernelProvider implements vscode.TreeDataProvider<KernelTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<KernelTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private kernelsApi: KernelsApi | null = null;
    private terminalsApi: TerminalsApi | null = null;

    private refreshTimer: NodeJS.Timeout | undefined;

    constructor() { }

    /**
     * 设置 API
     */
    setApis(kernelsApi: KernelsApi, terminalsApi: TerminalsApi): void {
        this.kernelsApi = kernelsApi;
        this.terminalsApi = terminalsApi;
        this.refresh();
        this.startAutoRefresh();
    }

    /**
     * 清除 API
     */
    clearApis(): void {
        this.kernelsApi = null;
        this.terminalsApi = null;
        this.stopAutoRefresh();
        this.refresh();
    }

    private startAutoRefresh() {
        this.stopAutoRefresh();
        // 获取刷新间隔
        const interval = ConfigManager.getKernelRefreshInterval();
        if (interval > 0) {
            this.refreshTimer = setInterval(() => {
                this.refresh();
            }, interval * 1000);
        }
    }

    private stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    /**
     * 刷新树
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 获取树节点
     */
    getTreeItem(element: KernelTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * 获取子节点
     */
    async getChildren(element?: KernelTreeItem): Promise<KernelTreeItem[]> {
        if (!this.kernelsApi || !this.terminalsApi) {
            return [];
        }

        try {
            if (!element) {
                // 根节点：显示类别
                return [
                    new KernelTreeItem(
                        '运行中会话 (Sessions)',
                        vscode.TreeItemCollapsibleState.Expanded,
                        'category'
                    ),
                    new KernelTreeItem(
                        '运行中终端 (Terminals)',
                        vscode.TreeItemCollapsibleState.Expanded,
                        'category'
                    ),
                    new KernelTreeItem(
                        '可用内核 (Kernel Specs)',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'category'
                    )
                ];
            }

            if (element.label === '可用内核 (Kernel Specs)') {
                // 获取内核规格
                const specs = await this.kernelsApi.getKernelSpecs();
                return Object.entries(specs.kernelspecs).map(([name, spec]) => {
                    const label = `${spec.spec.display_name} (${name})`;
                    const item = new KernelTreeItem(
                        label,
                        vscode.TreeItemCollapsibleState.None,
                        'kernelspec',
                        spec
                    );
                    item.description = spec.spec.language;
                    item.tooltip = `语言: ${spec.spec.language}`;
                    return item;
                });
            }

            if (element.label === '运行中会话 (Sessions)') {
                // 获取会话
                const sessions = await this.kernelsApi.listSessions();
                return sessions.map(session => {
                    // Using session path/name as label
                    const item = new KernelTreeItem(
                        session.notebook?.path || session.path || session.name,
                        vscode.TreeItemCollapsibleState.None,
                        'session',
                        session
                    );
                    item.tooltip = `Path: ${session.path}\nKernel: ${session.kernel?.name}\nState: ${session.kernel?.execution_state}`;
                    return item;
                });
            }

            if (element.label === '运行中终端 (Terminals)') {
                // 获取终端
                const terminals = await this.terminalsApi.listTerminals();
                return terminals.map(term => {
                    const item = new KernelTreeItem(
                        `Terminal ${term.name}`,
                        vscode.TreeItemCollapsibleState.None,
                        'terminal',
                        term
                    );
                    item.tooltip = `Name: ${term.name}\nLast Activity: ${term.last_activity}`;
                    return item;
                });
            }

            return [];
        } catch (error: any) {
            vscode.window.showErrorMessage(`获取资源信息失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 停止内核/会话
     */
    async stopKernel(item: KernelTreeItem): Promise<void> {
        if (!this.kernelsApi) {
            return;
        }

        if (item.contextValue === 'session') {
            const session = item.data as SessionModel;
            // Deleting a session usually kills the kernel too
            const confirmation = await vscode.window.showWarningMessage(
                `确定要关闭会话 "${session.path}" 吗？`,
                { modal: true },
                '关闭'
            );
            if (confirmation !== '关闭') return;

            try {
                // Need a deleteSession API? 
                // We don't have SessionsApi wrapper, but we can assume KernelsApi can handle it or we add deleteSession to KernelsApi
                // Actually KernelsApi needs deleteSession.
                // For now, let's just kill the kernel if we can't delete session yet.
                // But deleting kernel kills session.
                if (session.kernel) {
                    await this.kernelsApi.stopKernel(session.kernel.id);
                }
                this.refresh();
                vscode.window.showInformationMessage(`会话已关闭`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`关闭会话失败: ${error.message}`);
            }
        } else if (item.contextValue === 'kernel') {
            const kernel = item.data as KernelInfo;
            const confirmation = await vscode.window.showWarningMessage(
                `确定要停止内核 "${kernel.name}" 吗？`,
                { modal: true },
                '停止'
            );
            if (confirmation !== '停止') return;

            try {
                await this.kernelsApi.stopKernel(kernel.id);
                this.refresh();
                vscode.window.showInformationMessage(`内核 "${kernel.name}" 已停止`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`停止内核失败: ${error.message}`);
            }
        }
    }

    // ... Implement restartKernel/interruptKernel similarly
    async restartKernel(item: KernelTreeItem): Promise<void> {
        if (!this.kernelsApi) return;

        let kernelId: string | undefined;
        if (item.contextValue === 'session') {
            kernelId = (item.data as SessionModel).kernel?.id;
        } else if (item.contextValue === 'kernel') {
            kernelId = (item.data as KernelInfo).id;
        }

        if (kernelId) {
            try {
                await this.kernelsApi.restartKernel(kernelId);
                this.refresh();
                vscode.window.showInformationMessage(`内核已重启`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`重启内核失败: ${error.message}`);
            }
        }
    }

    async interruptKernel(item: KernelTreeItem): Promise<void> {
        if (!this.kernelsApi) return;

        let kernelId: string | undefined;
        if (item.contextValue === 'session') {
            kernelId = (item.data as SessionModel).kernel?.id;
        } else if (item.contextValue === 'kernel') {
            kernelId = (item.data as KernelInfo).id;
        }

        if (kernelId) {
            try {
                await this.kernelsApi.interruptKernel(kernelId);
                vscode.window.showInformationMessage(`内核已中断`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`中断内核失败: ${error.message}`);
            }
        }
    }

    /**
     * 删除终端
     */
    async deleteTerminal(item: KernelTreeItem): Promise<void> {
        if (!this.terminalsApi || item.contextValue !== 'terminal') return;

        const term = item.data as TerminalModel;
        const confirmation = await vscode.window.showWarningMessage(
            `确定要关闭终端 "${term.name}" 吗？`,
            { modal: true },
            '关闭'
        );
        if (confirmation !== '关闭') return;

        try {
            await this.terminalsApi.deleteTerminal(term.name);
            this.refresh();
            vscode.window.showInformationMessage(`终端 "${term.name}" 已关闭`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`关闭终端失败: ${error.message}`);
        }
    }
}
