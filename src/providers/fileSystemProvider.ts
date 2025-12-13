
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ContentsApi, ContentType } from '../api/contents';

export class JupyterHubFileSystemProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

    constructor(private contentsApi: ContentsApi) { }

    setContentsApi(api: ContentsApi) {
        this.contentsApi = api;
    }

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        // 暂不支持实时监听变化
        return new vscode.Disposable(() => { });
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        if (!this.contentsApi) throw vscode.FileSystemError.Unavailable('未连接到服务器');

        const path = this.getPathFromUri(uri);
        if (path === '' || path === '/') {
            return {
                type: vscode.FileType.Directory,
                ctime: Date.now(),
                mtime: Date.now(),
                size: 0
            };
        }

        try {
            // 只获取元数据，不获取内容
            const content = await this.contentsApi.get(path, false);

            let type = vscode.FileType.File;
            if (content.type === 'directory') {
                type = vscode.FileType.Directory;
            }

            return {
                type: type,
                ctime: new Date(content.created).getTime(),
                mtime: new Date(content.last_modified).getTime(),
                size: content.size || 0
            };
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound();
        }
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        if (!this.contentsApi) throw vscode.FileSystemError.Unavailable('未连接到服务器');

        const path = this.getPathFromUri(uri);
        try {
            const result = await this.contentsApi.listDirectory(path);
            return result.map(item => {
                let type = vscode.FileType.File;
                if (item.type === 'directory') type = vscode.FileType.Directory;
                return [item.name, type];
            });
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound();
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        if (!this.contentsApi) throw vscode.FileSystemError.Unavailable('未连接到服务器');
        const path = this.getPathFromUri(uri);
        await this.contentsApi.createDirectory(path);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (!this.contentsApi) throw vscode.FileSystemError.Unavailable('未连接到服务器');

        const path = this.getPathFromUri(uri);
        try {
            // 使用 getFile 强制获取文本内容
            const content = await this.contentsApi.getFile(path);

            if (content.content === null || content.content === undefined) {
                return new Uint8Array();
            }

            let textContent: string;
            if (typeof content.content === 'object') {
                textContent = JSON.stringify(content.content, null, 2);
            } else {
                textContent = String(content.content);
            }

            return new TextEncoder().encode(textContent);
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
        if (!this.contentsApi) throw vscode.FileSystemError.Unavailable('未连接到服务器');

        const path = this.getPathFromUri(uri);
        const textContent = new TextDecoder().decode(content);

        // 简单的类型推断
        let type: ContentType = 'file';
        let format: 'text' | 'json' | 'base64' = 'text';
        let contentPayload: any = textContent;

        if (path.endsWith('.ipynb')) {
            type = 'notebook';
            format = 'json';
            try {
                contentPayload = JSON.parse(textContent);
            } catch (e) {
                // 如果 JSON 解析失败，说明文件内容损坏，无法作为 Notebook 保存
                // 可以尝试作为普通文件保存，但这可能会改变服务器上的文件类型
                // 或者抛出错误提示用户
                Logger.warn('Notebook JSON 解析失败，尝试作为纯文本文件保存');
                type = 'file';
                format = 'text';
            }
        }

        try {
            await this.contentsApi.save(path, contentPayload, format, type);
        } catch (error) {
            // 提取更详细的错误信息
            let errMsg = String(error);
            if ((error as any).response && (error as any).response.data) {
                errMsg = JSON.stringify((error as any).response.data);
            }
            throw vscode.FileSystemError.Unavailable(`保存失败: ${errMsg}`);
        }
    }

    async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        if (!this.contentsApi) throw vscode.FileSystemError.Unavailable('未连接到服务器');
        const path = this.getPathFromUri(uri);
        await this.contentsApi.delete(path);
    }

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        if (!this.contentsApi) throw vscode.FileSystemError.Unavailable('未连接到服务器');
        const oldPath = this.getPathFromUri(oldUri);
        const newPath = this.getPathFromUri(newUri);
        await this.contentsApi.rename(oldPath, newPath);
    }

    private getPathFromUri(uri: vscode.Uri): string {
        // 移除开头的 /
        let path = uri.path;
        if (path.startsWith('/')) {
            path = path.substring(1);
        }
        return path;
    }
}
