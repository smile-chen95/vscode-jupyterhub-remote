import { ConfigManager } from './config';

type LogArgs = any[];

export class Logger {
    static log(...args: LogArgs) {
        if (ConfigManager.getDebug()) {
            console.log(...args);
        }
    }

    static warn(...args: LogArgs) {
        if (ConfigManager.getDebug()) {
            console.warn(...args);
        }
    }

    static error(...args: LogArgs) {
        if (ConfigManager.getDebug()) {
            console.error(...args);
        }
    }
}

