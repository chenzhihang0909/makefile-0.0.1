import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { handleBatchGenerateMk, removeGenerateMK } from './include/include';
import { SortViewHtml } from './sortView/sortView'
let decorationType: vscode.TextEditorDecorationType | undefined;
const isShowSortLink = 'wing.sortlinkflag'
export function activate(context: vscode.ExtensionContext) {
    vscode.commands.executeCommand('setContext', isShowSortLink, false);

    console.log('✅ wing-makefile 插件已激活');
    const generateMkCommand = vscode.commands.registerCommand(
        'c-mk-auto-generator.generateMk',
        async (selectedFolder: string, targetArgs:any) => {
            // await handleBatchGenerateMk('/home/chenzhihang/workspace/demo_130C', {flag:false});
            await handleBatchGenerateMk(selectedFolder, targetArgs);
        }
    );
    context.subscriptions.push(generateMkCommand);
    const sortObjs = vscode.commands.registerCommand(
        'c-sort-objs.panelView',
        async (selectedFolder: string)=>{
            // console.log('命令 c-sort-objs.panelView 被触发');
           const panel = vscode.window.createWebviewPanel(
                'c-sort-objs.view',   
                'Link Order Sorting', 
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                }
            );
            const Sorttablejs = vscode.Uri.file(path.join(context.extensionPath, 'public', 'Sorttable.js'))
            
            panel.webview.html = await SortViewHtml(selectedFolder,panel.webview.asWebviewUri(Sorttablejs))
            panel.onDidDispose(() => {}, null, context.subscriptions);
            panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg.type === 'save-objs-json') {
                    try {
                        const saveData = JSON.stringify({ OBJS: msg.data }, null, 4);
                        await fs.writeFile(path.join(selectedFolder,'output','OBJS.json'), saveData, 'utf8');
                        // vscode.window.setStatusBarMessage('OBJS.json 顺序已保存', 2000);
                    } catch (e) {
                        // vscode.window.showErrorMessage(`保存文件失败: ${(e as Error).message}`);
                    }
                }
            });
        }
    )
    context.subscriptions.push(sortObjs);

    const removeMkCommand = vscode.commands.registerCommand(
        'c-mk-auto-generator.removeMk',
        async (selectedFolder: string) => {
            await removeGenerateMK(selectedFolder);
        }
    );
    context.subscriptions.push(removeMkCommand);

    vscode.window.onDidChangeActiveTextEditor(() => {
        console.log('aaaaaa')
    });

}

export function deactivate() {
    decorationType?.dispose();
}
