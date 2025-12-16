import * as vscode from 'vscode';
import { JupyterHubApi, ServerInfo, UserInfo } from '../api/hub';
import { ConfigManager } from '../utils/config';

export class ServerTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly description?: string,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);

        if (contextValue === 'server') {
            this.iconPath = new vscode.ThemeIcon('server');
        } else if (contextValue === 'user') {
            this.iconPath = new vscode.ThemeIcon('account');
        } else if (contextValue === 'userManagement') {
            this.iconPath = new vscode.ThemeIcon('organization');
        } else if (contextValue === 'hubUser') {
            this.iconPath = new vscode.ThemeIcon('account');
        } else if (contextValue === 'connectedServer') {
            this.iconPath = new vscode.ThemeIcon('remote');
        } else if (contextValue === 'disconnected') {
            this.iconPath = new vscode.ThemeIcon('plug');
        } else if (contextValue === 'switchServer') {
            this.iconPath = new vscode.ThemeIcon('server-environment');
        } else if (contextValue === 'addServer') {
            this.iconPath = new vscode.ThemeIcon('add');
        } else if (contextValue === 'group') {
            this.iconPath = new vscode.ThemeIcon('layers');
        } else if (contextValue === 'status') {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}

export class ServerProvider implements vscode.TreeDataProvider<ServerTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ServerTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private userInfo: UserInfo | null = null;
    private serverUrl: string | null = null;

    constructor(private hubApi: JupyterHubApi | null = null) {
        this.serverUrl = ConfigManager.getServerUrl() || null;
    }

    setHubApi(api: JupyterHubApi | null) {
        this.hubApi = api;
        // setHubApi is called with null on disconnect, so we need to refresh config check
        this.serverUrl = ConfigManager.getServerUrl() || null;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ServerTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ServerTreeItem): Promise<ServerTreeItem[]> {
        const savedUrl = ConfigManager.getServerUrl();
        const recentServers = ConfigManager.getRecentServers();

        const resolveDefaultServer = (user: UserInfo): ServerInfo | null => {
            const rawDefaultServer = (user as any).server;
            const defaultServer =
                rawDefaultServer && typeof rawDefaultServer === 'object'
                    ? (rawDefaultServer as ServerInfo)
                    : null;
            return defaultServer || user.servers?.[''] || user.servers?.['default'] || null;
        };

        const formatLastActivity = (iso?: string): string => {
            if (!iso) return '-';
            const dt = new Date(iso);
            if (Number.isNaN(dt.getTime())) return iso;
            return dt.toLocaleString();
        };

        // Level 2: Children of groups (Recent Servers / Switch Other Servers)
        if (element && element.contextValue === 'group') {
            const items: ServerTreeItem[] = [];

            const uniqueRecent = Array.from(new Set(recentServers));
            for (const url of uniqueRecent) {
                // 如果是已连接状态，并且这个 URL 就是当前连接的 URL，则跳过（因为已经在 Root 显示了）
                // 或者是未连接状态下，Root 已经显示了 savedUrl，也跳过
                if (this.serverUrl && url === this.serverUrl) continue;
                if (!this.serverUrl && savedUrl && url === savedUrl) continue;

                const cmd: vscode.Command = {
                    command: 'jupyterhub.connectServer',
                    title: '切换服务器',
                    arguments: [url]
                };

                items.push(new ServerTreeItem(
                    url,
                    vscode.TreeItemCollapsibleState.None,
                    'switchServer',
                    '点击切换',
                    cmd
                ));
            }

            // 连接新服务器入口（放在最后）
            items.push(new ServerTreeItem(
                '连接新的服务器...',
                vscode.TreeItemCollapsibleState.None,
                'addServer',
                '',
                {
                    command: 'jupyterhub.connectServer',
                    title: '新建连接',
                    arguments: ['__new__']
                }
            ));

            return items;
        }

        if (element && element.contextValue === 'userManagement') {
            if (!this.hubApi) return [];
            try {
                const users = await this.hubApi.listAllUsers();
                users.sort((a, b) => {
                    const at = a.last_activity ? new Date(a.last_activity).getTime() : 0;
                    const bt = b.last_activity ? new Date(b.last_activity).getTime() : 0;
                    const aTime = Number.isFinite(at) ? at : 0;
                    const bTime = Number.isFinite(bt) ? bt : 0;
                    if (bTime !== aTime) return bTime - aTime;
                    return (a.name || '').localeCompare(b.name || '');
                });

                return users.map((u) => {
                    const server = resolveDefaultServer(u);
                    const isRunning = !!server;
                    const lastActivity = formatLastActivity(u.last_activity);
                    const description = isRunning ? `运行中，${lastActivity}` : `未运行，${lastActivity}`;
                    return new ServerTreeItem(
                        u.name,
                        vscode.TreeItemCollapsibleState.None,
                        'hubUser',
                        description
                    );
                });
            } catch (error: any) {
                return [
                    new ServerTreeItem(
                        '无法获取用户列表',
                        vscode.TreeItemCollapsibleState.None,
                        'status',
                        error?.message ? String(error.message) : ''
                    )
                ];
            }
        }

        // Level 1: Root items
        if (element) {
            return [];
        }

        const items: ServerTreeItem[] = [];
        const connectCommand: vscode.Command = {
            command: 'jupyterhub.connectServer',
            title: '连接到服务器'
        };

        // === 未连接状态 ===
        if (!this.hubApi) {
            // 1. 主要连接入口
            if (savedUrl) {
                items.push(new ServerTreeItem(
                    savedUrl,
                    vscode.TreeItemCollapsibleState.None,
                    'disconnected',
                    '点击重连 (上次)',
                    connectCommand
                ));
            } else {
                items.push(new ServerTreeItem(
                    '未配置服务器',
                    vscode.TreeItemCollapsibleState.None,
                    'disconnected',
                    '点击配置',
                    connectCommand
                ));
            }

            // 2. 及其它历史记录
            if (recentServers.length > 0) {
                items.push(new ServerTreeItem(
                    '最近访问',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'group',
                    `(${recentServers.length})`
                ));
            } else if (!savedUrl) {
                // 如果没有任何记录，直接放一个 "连接新服务器" 在根目录方便点击
                items.push(new ServerTreeItem(
                    '连接新服务器...',
                    vscode.TreeItemCollapsibleState.None,
                    'addServer',
                    '',
                    { command: 'jupyterhub.connectServer', title: '新建连接', arguments: ['__new__'] }
                ));
            }

            return items;
        }

        // === 已连接状态 ===
        try {
            if (!this.userInfo) {
                this.userInfo = await this.hubApi.getCurrentUser();
            }

            // 1. 当前连接信息
            items.push(new ServerTreeItem(
                this.serverUrl || 'Current Server',
                vscode.TreeItemCollapsibleState.None,
                'connectedServer',
                '已连接'
            ));

            // 2. 用户信息（第二行显示）
            if (this.userInfo) {
                items.push(new ServerTreeItem(
                    this.userInfo.name,
                    vscode.TreeItemCollapsibleState.None,
                    'user',
                    this.userInfo.admin ? '管理员' : '用户'
                ));

                if (this.userInfo.admin) {
                    items.push(new ServerTreeItem(
                        '用户管理',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'userManagement',
                        '点击展开'
                    ));
                }
            }

            // 3. 切换其他服务器（可展开：历史记录 + 连接新的服务器）
            items.push(new ServerTreeItem(
                '切换其他服务器',
                vscode.TreeItemCollapsibleState.Collapsed,
                'group',
                ''
            ));

            return items;

        } catch (error: any) {
            vscode.window.showErrorMessage(`获取服务器信息失败: ${error.message}`);
            return [new ServerTreeItem('获取信息失败', vscode.TreeItemCollapsibleState.None, 'status')];
        }
    }
}
