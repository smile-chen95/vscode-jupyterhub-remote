
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger';

export interface KernelMessage {
    header: {
        msg_id: string;
        username: string;
        session: string;
        msg_type: string;
        version: string;
        date: string;
    };
    parent_header: any;
    metadata: any;
    content: any;
    channel?: string;
    buffers?: any[];
}

export class RemoteKernelSession {
    private ws: WebSocket | null = null;
    private msgIdToHandler = new Map<string, (msg: any) => void>();
    private session: string = uuidv4();

    constructor(
        private wsUrl: string,
        private token: string
    ) { }

    async connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const headers = { 'Authorization': `token ${this.token}` };
        this.ws = new WebSocket(this.wsUrl, { headers });

        this.ws.on('open', () => {
            Logger.log('Kernel WebSocket connected');
        });

        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this.handleMessage(msg);
            } catch (e) {
                Logger.error('Error parsing kernel message', e);
            }
        });

        this.ws.on('error', (e) => {
            Logger.error('Kernel WebSocket error', e);
        });

        return new Promise<void>((resolve, reject) => {
            this.ws!.once('open', () => resolve());
            this.ws!.once('error', (err) => reject(err));
        });
    }

    private handleMessage(msg: any) {
        const parentId = msg.parent_header?.msg_id;
        if (parentId && this.msgIdToHandler.has(parentId)) {
            const handler = this.msgIdToHandler.get(parentId);
            handler!(msg);
        }
    }

    async executeCode(code: string, onOutput: (output: any) => void): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Kernel not connected');
        }

        const msgId = uuidv4();
        const msg: KernelMessage = {
            header: {
                msg_id: msgId,
                username: 'vscode',
                session: this.session,
                msg_type: 'execute_request',
                version: '5.3',
                date: new Date().toISOString()
            },
            parent_header: {},
            metadata: {},
            content: {
                code: code,
                silent: false,
                store_history: true,
                user_expressions: {},
                allow_stdin: false,
                stop_on_error: true
            },
            channel: 'shell'
        };

        this.ws.send(JSON.stringify(msg));

        return new Promise((resolve) => {
            const handler = (msg: any) => {
                const msgType = msg.header.msg_type;

                // 处理输出
                if (msgType === 'stream' || msgType === 'execute_result' || msgType === 'display_data' || msgType === 'error') {
                    onOutput(msg);
                }

                // 处理状态变更
                if (msgType === 'status' && msg.content.execution_state === 'idle') {
                    // 完成
                    this.msgIdToHandler.delete(msgId);
                    resolve();
                }
            };
            this.msgIdToHandler.set(msgId, handler);
        });
    }

    async requestComplete(code: string, cursor_pos: number): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return null;
        }

        const msgId = uuidv4();
        const msg: KernelMessage = {
            header: {
                msg_id: msgId,
                username: 'vscode',
                session: this.session,
                msg_type: 'complete_request',
                version: '5.3',
                date: new Date().toISOString()
            },
            parent_header: {},
            metadata: {},
            content: {
                code,
                cursor_pos
            },
            channel: 'shell'
        };

        this.ws.send(JSON.stringify(msg));

        return new Promise((resolve) => {
            const handler = (msg: any) => {
                if (msg.header.msg_type === 'complete_reply') {
                    this.msgIdToHandler.delete(msgId);
                    resolve(msg.content);
                }
            };
            this.msgIdToHandler.set(msgId, handler);
        });
    }

    dispose() {
        if (this.ws) {
            this.ws.close();
        }
    }
}
