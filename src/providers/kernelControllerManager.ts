
import * as vscode from 'vscode';
import { KernelsApi } from '../api/kernels';
import { RemoteKernelController } from '../kernel/controller';
import { Logger } from '../utils/logger';

export class KernelControllerManager {
    private controllers: RemoteKernelController[] = [];

    constructor() { }

    async refreshControllers(kernelsApi: KernelsApi, serverUrl: string, token: string) {
        // 清理旧的
        this.dispose();

        try {
            const specs = await kernelsApi.getKernelSpecs();
            Logger.log('Available kernelspecs:', specs);

            for (const [name, spec] of Object.entries(specs.kernelspecs)) {
                // 为每个 spec 创建 controller
                // 将 name 注入到 spec 对象中方便使用
                const fullSpec = { ...spec, name: name };
                const controller = new RemoteKernelController(fullSpec, kernelsApi, serverUrl, token);
                this.controllers.push(controller);
            }
            Logger.log(`Registered ${this.controllers.length} kernel controllers`);
            if (this.controllers.length > 0) {
                vscode.window.setStatusBarMessage(`已加载 ${this.controllers.length} 个远程内核`, 5000);
            } else {
                vscode.window.showWarningMessage('未发现可用的远程内核');
            }
        } catch (e) {
            Logger.error('Error refreshing kernel controllers:', e);
            vscode.window.showErrorMessage('Failed to load remote kernels');
        }
    }

    dispose() {
        this.controllers.forEach(c => c.dispose());
        this.controllers = [];
    }
}
