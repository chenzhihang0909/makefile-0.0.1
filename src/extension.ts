import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { handleBatchGenerateMk, removeGenerateMK } from './include/include';
import { SortViewHtml } from './sortView/sortView'
import { promisify } from 'util';
import { exec } from 'child_process';
let decorationType: vscode.TextEditorDecorationType | undefined;
const isShowSortLink = 'wing.sortlinkflag'
let outputChannel: vscode.OutputChannel;
const execAsync = promisify(exec);

// 服务器目标目录（插件运行在服务器，本地磁盘路径）
const REMOTE_LOG_DIR = "/wingstudio/user-data-logs";

export function activate(context: vscode.ExtensionContext) {
    vscode.commands.executeCommand('setContext', isShowSortLink, false);

    console.log('✅ wing-makefile 插件已激活');
    const generateMkCommand = vscode.commands.registerCommand(
        'c-mk-auto-generator.generateMk',
        async (selectedFolder: string, targetArgs: any) => {
            await handleBatchGenerateMk(selectedFolder, targetArgs);
        }
    );
    context.subscriptions.push(generateMkCommand);
    const sortObjs = vscode.commands.registerCommand(
        'c-sort-objs.panelView',
        async (selectedFolder: any) => {
            console.log('命令 c-sort-objs.panelView 被触发');
            let activeConfigKey
            try {
                const settingJson = await fs.readFile(path.join(selectedFolder, 'config', 'setting.json'), 'utf8');
                const settingConfig = JSON.parse(settingJson);
                activeConfigKey = settingConfig.ActiveConfigure;
                let fileContent = await fs.readFile(path.join(selectedFolder, 'output', activeConfigKey, 'OBJS.json'), 'utf8')

                let jsonData = JSON.parse(fileContent);
                if (jsonData && jsonData.OBJS && jsonData.OBJS.length > 32) {
                    vscode.window.showErrorMessage(`Link order sorting supports up to 32 files.`);
                    return
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Missing OBJS.json file, please reactivate the project.`);
                return
            }
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

            panel.webview.html = await SortViewHtml(selectedFolder, panel.webview.asWebviewUri(Sorttablejs), activeConfigKey)
            panel.onDidDispose(() => { }, null, context.subscriptions);
            panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg.type === 'save-objs-json') {
                    try {
                        const saveData = JSON.stringify({ OBJS: msg.data }, null, 4);
                        const settingJson = await fs.readFile(path.join(selectedFolder, 'config', 'setting.json'), 'utf8');
                        const settingConfig = JSON.parse(settingJson);
                        const activeConfigKey = settingConfig.ActiveConfigure;
                        await fs.writeFile(path.join(selectedFolder, 'output', activeConfigKey, 'OBJS.json'), saveData, 'utf8');
                    } catch (e) {
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

    outputChannel = vscode.window.createOutputChannel('Tar Deploy');
    const packUploadCmd = vscode.commands.registerCommand(
        'tar-deploy-sftp.packAndUpload',
        async (folderUri: vscode.Uri) => {
            let tempTarPath: string | null = null;
            try {
                const folderPath = folderUri.fsPath;
                console.log(`Trigger pack‑and‑upload command, folder path: ${folderPath}`);
                const folderName = path.basename(folderPath);
                const timestamp = Date.now();
                const tempTarName = `${folderName}-${timestamp}.tar.gz`;
                const folderParentDir = path.dirname(folderPath);
                tempTarPath = path.join(folderParentDir, tempTarName);

                outputChannel.show();
                outputChannel.appendLine(`Start processing folder: ${folderPath}`);

                // Step1: 打包
                await packFolderToTar(folderPath, tempTarPath);
                outputChannel.appendLine(`Packing completed, archive path: ${tempTarPath}`);

                const targetTarPath = path.join(REMOTE_LOG_DIR, tempTarName);

                // Step3: 将tar包移动到服务器目标目录
                await fs.rename(tempTarPath, targetTarPath);
                outputChannel.appendLine(`Tar file moved to target dir: ${targetTarPath}`);
                // 移动成功，清空标记，不需要清理
                tempTarPath = null;

                vscode.window.showInformationMessage(`Package success, saved to ${REMOTE_LOG_DIR}/${tempTarName}`);

            } catch (err: any) {
                // 移动/打包失败：如果临时tar包存在，做清理
                if (tempTarPath) {
                    try {
                        await fs.unlink(tempTarPath);
                        outputChannel.appendLine(`Cleanup temporary tar: ${tempTarPath}`);
                    } catch (cleanErr) {
                        outputChannel.appendLine(`Warning: clean temp tar failed: ${(cleanErr as Error).message}`);
                    }
                }
                outputChannel.appendLine(`Execution failed: ${err.message}`);
                vscode.window.showErrorMessage(`Pack & upload failed: ${err.message}`);
            }
        }
    );

    context.subscriptions.push(packUploadCmd);
}

export function deactivate() {
    decorationType?.dispose();
}

async function packFolderToTar(folderDir: string, outputTar: string) {
    const folderBase = path.dirname(folderDir);
    const folderName = path.basename(folderDir);
    let tarCmd: string;

    if (process.platform === 'win32') {
        tarCmd = `cd "${folderBase}" && tar -zcvf "${outputTar}" "${folderName}"`;
    } else {
        tarCmd = `cd "${folderBase}" && tar -zcvf "${outputTar}" "${folderName}"`;
    }

    outputChannel.appendLine(`Execute pack command: ${tarCmd}`);
    await execAsync(tarCmd, { maxBuffer: 1024 * 1024 * 500 });

    try {
        await fs.access(outputTar);
    } catch {
        throw new Error('Failed to generate tar archive');
    }
}
