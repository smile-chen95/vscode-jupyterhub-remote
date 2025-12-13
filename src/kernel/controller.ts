
import * as vscode from 'vscode';
import { KernelsApi, KernelSpec } from '../api/kernels';
import { RemoteKernelSession } from './kernelSession';

export class RemoteKernelController {
    private controller: vscode.NotebookController;
    private executions = new Map<string, RemoteKernelSession>();

    constructor(
        private readonly kernelSpec: KernelSpec,
        private readonly kernelsApi: KernelsApi,
        private readonly serverUrl: string,
        private readonly token: string
    ) {
        this.controller = vscode.notebooks.createNotebookController(
            `jupyterhub-remote-${kernelSpec.name}`,
            'jupyter-notebook',
            `Remote: ${kernelSpec.spec.display_name}`,
            // handler
            this.executeHandler.bind(this)
        );
        this.controller.supportedLanguages = [kernelSpec.spec.language.toLowerCase()];
        this.controller.description = 'JupyterHub Remote Kernel';
        this.controller.detail = `Language: ${kernelSpec.spec.language}`;
    }

    dispose() {
        this.controller.dispose();
        this.executions.forEach(session => session.dispose());
        this.executions.clear();
    }

    private async executeHandler(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        // 1. 获取或创建 Kernel Session
        let session = this.executions.get(_notebook.uri.toString());
        if (!session) {
            try {
                // 启动一个新的 Kernel (不创建 Jupyter Session，只是 Kernel)
                // 或者我们可以创建 Jupyter Session 来更好地管理
                // 这里简单起见，直接启动 Kernel
                const kernel = await this.kernelsApi.startKernel(this.kernelSpec.name);

                // 构造 WebSocket URL (确保处理 https -> wss)
                const baseUrl = this.serverUrl.replace(/^http/, 'ws');
                const wsUrl = `${baseUrl}/api/kernels/${kernel.id}/channels`;

                session = new RemoteKernelSession(wsUrl, this.token);
                await session.connect();
                this.executions.set(_notebook.uri.toString(), session);

                // 监听 Notebook 关闭以清理
                // (此处简化，未实现自动清理逻辑)

            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to start kernel: ${err.message}`);
                return;
            }
        }

        // 2. 执行 Cell
        for (const cell of cells) {
            await this.executeCell(cell, session);
        }
    }

    private async executeCell(cell: vscode.NotebookCell, session: RemoteKernelSession): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now()); // Set start time

        try {
            await session.executeCode(cell.document.getText(), (msg) => {
                this.handleIOPubMessage(execution, msg);
            });
            execution.end(true, Date.now());
        } catch (err) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(err as Error)
                ])
            ]);
            execution.end(false, Date.now());
        }
    }

    private executionOrder = 0;

    private handleIOPubMessage(execution: vscode.NotebookCellExecution, msg: any) {
        const msgType = msg.header.msg_type;
        const content = msg.content;

        if (msgType === 'stream') {
            const text = content.text;
            if (content.name === 'stdout') {
                execution.appendOutput(new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(text, 'text/plain')
                ]));
            } else if (content.name === 'stderr') {
                // 显示为 stderr 样式通常还是 text/plain 但可能想区分
                execution.appendOutput(new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(text, 'application/vnd.code.notebook.stderr')
                ]));
            }
        } else if (msgType === 'execute_result' || msgType === 'display_data') {
            const data = content.data;
            const items: vscode.NotebookCellOutputItem[] = [];

            // 遍历 MIME types
            for (const key in data) {
                let mimeType = key;
                let value = data[key];
                // 处理 JSON 数据
                if (typeof value === 'object') {
                    // some mimetypes expect string, some object?
                    // VSCode generally handles objects for application/json
                }
                items.push(new vscode.NotebookCellOutputItem(this.encodeData(value), mimeType));
            }
            execution.appendOutput(new vscode.NotebookCellOutput(items));
        } else if (msgType === 'error') {
            execution.appendOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.error({
                    name: content.ename,
                    message: content.evalue,
                    stack: content.traceback.join('\n')
                })
            ]));
        }
    }

    private encodeData(data: any): Uint8Array {
        if (typeof data === 'string') {
            return new TextEncoder().encode(data);
        }
        // 如果是数组或其他对象，尝试 JSON stringify
        return new TextEncoder().encode(JSON.stringify(data));
    }
}
