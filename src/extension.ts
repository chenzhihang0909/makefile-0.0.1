import * as vscode from 'vscode';
// import * as fs from 'fs';
// import * as path from 'path';
import { handleBatchGenerateMk, removeGenerateMK } from './include/include';
let decorationType: vscode.TextEditorDecorationType | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ wing-makefile 插件已激活');
    const generateMkCommand = vscode.commands.registerCommand(
        'c-mk-auto-generator.generateMk',
        async (selectedFolder: string, targetArgs:any) => {
            await handleBatchGenerateMk(selectedFolder, targetArgs);
        }
    );
    context.subscriptions.push(generateMkCommand);
    const removeMkCommand = vscode.commands.registerCommand(
        'c-mk-auto-generator.removeMk',
        async (selectedFolder: string) => {
            await removeGenerateMK(selectedFolder);
        }
    );
    context.subscriptions.push(removeMkCommand);
}

export function deactivate() {
    decorationType?.dispose();
}
