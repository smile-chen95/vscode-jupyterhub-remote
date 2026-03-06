/**
 * 远程终端实现
 * 使用 WebSocket 连接到 Jupyter Terminal
 */

import * as vscode from 'vscode';
import WebSocket from 'ws';

export class RemoteTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    private ws?: WebSocket;
    private dimensions?: vscode.TerminalDimensions;
    private heartbeatTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private isManualClose = false;
    private isConnecting = false;
    private reconnectAttempts = 0;
    private lastCloseCode: number | undefined;
    private lastCloseReason = '';
    private static readonly heartbeatIntervalMs = 20000;
    private static readonly maxReconnectAttempts = 8;
    private static readonly reconnectBaseDelayMs = 1000;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

    constructor(
        private wsUrl: string,
        private token: string,
        private terminalName: string
    ) { }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.dimensions = initialDimensions;
        this.isManualClose = false;
        this.reconnectAttempts = 0;
        this.connect();
    }

    close(): void {
        this.isManualClose = true;
        this.stopHeartbeat();
        this.stopReconnect();
        if (this.ws) {
            this.ws.close();
        }
    }

    handleInput(data: string): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Jupyter Terminal 使用数组格式的消息：['stdin', data]
            const message = JSON.stringify(['stdin', data]);
            this.ws.send(message);
            return;
        }

        // 连接断开但终端仍保留时，用户输入会触发一次快速重连。
        if (!this.isManualClose && !this.isConnecting) {
            this.writeEmitter.fire('\r\n*** 检测到输入，正在尝试重连终端... ***\r\n');
            this.connect();
        }
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.dimensions = dimensions;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // 发送终端大小调整消息
            const message = JSON.stringify([
                'set_size',
                dimensions.rows,
                dimensions.columns
            ]);
            this.ws.send(message);
        }
    }

    private connect(): void {
        if (this.isManualClose || this.isConnecting) {
            return;
        }

        this.isConnecting = true;

        try {
            // 创建 WebSocket 连接
            const socket = new WebSocket(this.wsUrl, {
                headers: {
                    'Authorization': `token ${this.token}`
                }
            });
            this.ws = socket;

            socket.on('open', () => {
                if (this.ws !== socket) {
                    return;
                }

                this.isConnecting = false;
                const wasReconnecting = this.reconnectAttempts > 0;
                this.reconnectAttempts = 0;
                this.startHeartbeat();

                if (wasReconnecting) {
                    this.writeEmitter.fire(`\r\n*** 终端已重连 (${this.terminalName}) ***\r\n\r\n`);
                } else {
                    this.writeEmitter.fire(`\r\n*** 已连接到远程终端 (${this.terminalName}) ***\r\n\r\n`);
                }

                // 如果有初始尺寸，发送给服务器
                if (this.dimensions) {
                    this.setDimensions(this.dimensions);
                }
            });

            socket.on('message', (data: WebSocket.Data) => {
                if (this.ws !== socket) {
                    return;
                }
                try {
                    const message = JSON.parse(data.toString());

                    // Jupyter Terminal 消息格式：['stdout', data] 或 ['disconnect', ...]
                    if (Array.isArray(message)) {
                        const [type, content] = message;

                        if (type === 'stdout') {
                            this.writeEmitter.fire(content);
                        } else if (type === 'disconnect') {
                            this.writeEmitter.fire('\r\n*** 收到服务端断开通知，准备重连 ***\r\n');
                            socket.close(4000, 'server-disconnect');
                        }
                    }
                } catch (error) {
                    // 忽略解析错误
                }
            });

            socket.on('error', (error) => {
                if (this.ws !== socket) {
                    return;
                }
                this.writeEmitter.fire(`\r\n*** 终端错误: ${error.message} ***\r\n`);
            });

            socket.on('close', (code, reasonBuffer) => {
                if (this.ws !== socket) {
                    return;
                }

                this.isConnecting = false;
                this.stopHeartbeat();
                const reason = reasonBuffer.toString() || '无';
                this.lastCloseCode = code;
                this.lastCloseReason = reason;
                this.writeEmitter.fire(`\r\n*** 终端连接已关闭（code=${code}, reason=${reason}）***\r\n`);

                if (this.isManualClose) {
                    this.closeEmitter.fire(0);
                    return;
                }

                if (this.reconnectAttempts >= RemoteTerminal.maxReconnectAttempts) {
                    this.stopReconnect();
                    this.writeEmitter.fire('\r\n*** 重连失败次数过多，终端保持打开以便查看日志。可直接输入任意字符触发重连，或手动关闭后重开。***\r\n');
                    vscode.window.showWarningMessage(
                        `JupyterHub Terminal (${this.terminalName}) 连接中断，已停止自动重连（code=${this.lastCloseCode ?? 'unknown'}）。终端未关闭，可查看日志后重试。`
                    );
                    return;
                }

                this.scheduleReconnect();
            });

        } catch (error: any) {
            this.isConnecting = false;
            this.writeEmitter.fire(`\r\n*** 无法连接到终端: ${error.message} ***\r\n`);
            this.scheduleReconnect();
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            try {
                // 发送 ping，减少被代理层按空闲连接超时回收的概率。
                this.ws.ping();
            } catch (error: any) {
                this.writeEmitter.fire(`\r\n*** 心跳发送失败: ${error.message} ***\r\n`);
            }
        }, RemoteTerminal.heartbeatIntervalMs);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    private scheduleReconnect(): void {
        if (this.isManualClose) {
            return;
        }

        this.stopReconnect();

        this.reconnectAttempts += 1;
        const delayMs = Math.min(
            15000,
            RemoteTerminal.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1)
        );

        this.writeEmitter.fire(`\r\n*** 终端断开，${Math.round(delayMs / 1000)}s 后尝试第 ${this.reconnectAttempts} 次重连... ***\r\n`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect();
        }, delayMs);
    }

    private stopReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }
}
