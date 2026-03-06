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
    private static readonly heartbeatIntervalMs = 25000;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

    constructor(
        private wsUrl: string,
        private token: string,
        private terminalName: string
    ) { }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.dimensions = initialDimensions;
        this.connect();
    }

    close(): void {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
        }
    }

    handleInput(data: string): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Jupyter Terminal 使用数组格式的消息：['stdin', data]
            const message = JSON.stringify(['stdin', data]);
            this.ws.send(message);
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
        try {
            // 创建 WebSocket 连接
            this.ws = new WebSocket(this.wsUrl, {
                headers: {
                    'Authorization': `token ${this.token}`
                }
            });

            this.ws.on('open', () => {
                this.writeEmitter.fire(`\r\n*** 已连接到远程终端 (${this.terminalName}) ***\r\n\r\n`);
                this.startHeartbeat();

                // 如果有初始尺寸，发送给服务器
                if (this.dimensions) {
                    this.setDimensions(this.dimensions);
                }
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString());

                    // Jupyter Terminal 消息格式：['stdout', data] 或 ['disconnect', ...]
                    if (Array.isArray(message)) {
                        const [type, content] = message;

                        if (type === 'stdout') {
                            this.writeEmitter.fire(content);
                        } else if (type === 'disconnect') {
                            this.stopHeartbeat();
                            this.writeEmitter.fire('\r\n*** 终端已断开连接（服务端通知）***\r\n');
                            this.closeEmitter.fire(0);
                        }
                    }
                } catch (error) {
                    // 忽略解析错误
                }
            });

            this.ws.on('error', (error) => {
                this.writeEmitter.fire(`\r\n*** 终端错误: ${error.message} ***\r\n`);
            });

            this.ws.on('close', (code, reasonBuffer) => {
                this.stopHeartbeat();
                const reason = reasonBuffer.toString() || '无';
                this.writeEmitter.fire(`\r\n*** 终端连接已关闭（code=${code}, reason=${reason}）***\r\n`);
                this.closeEmitter.fire(0);
            });

        } catch (error: any) {
            this.stopHeartbeat();
            this.writeEmitter.fire(`\r\n*** 无法连接到终端: ${error.message} ***\r\n`);
            this.closeEmitter.fire(1);
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            try {
                // 发送 WebSocket ping，避免中间代理按空闲连接超时回收。
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
}
