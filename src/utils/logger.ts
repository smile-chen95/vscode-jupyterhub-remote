import * as vscode from 'vscode';
import { ConfigManager } from './config';

type LogArgs = any[];

export class Logger {
    private static outputChannel: vscode.OutputChannel | null = null;

    private static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('JupyterHub Remote');
        }
        return this.outputChannel;
    }

    private static formatArg(arg: any): string {
        if (arg instanceof Error) {
            return arg.stack || `${arg.name}: ${arg.message}`;
        }
        if (typeof arg === 'string') {
            return arg;
        }
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }

    private static write(level: 'INFO' | 'WARN' | 'ERROR', args: LogArgs): void {
        const line = `${new Date().toISOString()} [${level}] ${args.map((arg) => this.formatArg(arg)).join(' ')}`;
        this.getOutputChannel().appendLine(line);
    }

    static log(...args: LogArgs) {
        if (ConfigManager.getDebug()) {
            console.log(...args);
            this.write('INFO', args);
        }
    }

    static warn(...args: LogArgs) {
        if (ConfigManager.getDebug()) {
            console.warn(...args);
            this.write('WARN', args);
        }
    }

    static error(...args: LogArgs) {
        console.error(...args);
        this.write('ERROR', args);
    }

    static show(): void {
        this.getOutputChannel().show(true);
    }
}
