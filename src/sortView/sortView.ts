import * as path from 'path';
import * as fs from 'fs/promises';

export async function SortViewHtml(selectedFolder: string, sorttableurl:any, activeConfigKey:any): Promise<string> {
    const OBJSJsonPath = path.join(selectedFolder, 'output', activeConfigKey, 'OBJS.json');
    let objsConfig: any = { OBJS: [] };

    try {
        const OBJSJsonContent = await fs.readFile(OBJSJsonPath, 'utf8');
        objsConfig = JSON.parse(OBJSJsonContent);
    } catch (err) {
        objsConfig = { OBJS: [] };
    }

    const initObjsList = JSON.stringify(objsConfig.OBJS || []);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Link Order Sort</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui; }
        html, body { height: 100%; }
        body {
            height: 100vh;
            display: flex;
            flex-direction: column;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 12px;
            gap: 16px;
            overflow: hidden; /* 关键：禁止页面整体滚动，溢出只会内部滚动 */
        }

        /* 通用面板容器样式，强化区分感 */
        .panel {
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            flex: 1; /* 上下面板均分高度，各占50% */
            min-height: 0; /* flex子元素超出压缩修复，必加 */
        }
        /* 上下面板区分背景，不再固定高度占比 */
        .top-panel {
            background: var(--vscode-sideBar-background);
        }
        .bottom-panel {
            background: var(--vscode-editorWidget-background);
        }

        .panel-title {
            font-size: 15px; font-weight: 600; margin-bottom: 10px;
            color: var(--vscode-textLink-foreground);
            padding-bottom: 6px;
            border-bottom: 1px solid var(--vscode-sideBar-border);
        }
        #json-preview {
            flex: 1;
            padding: 10px;
            border: 1px solid var(--vscode-sideBar-border);
            border-radius: 4px;
            overflow: auto; /* 内容溢出内部滚动 */
            white-space: pre-wrap;
            font-family: "Consolas", monospace;
            font-size: 12px;
            line-height: 1.6;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
        }

        /* Right Sortable List */
        .sort-wrap {
            flex: 1;
            overflow: auto; /* 列表溢出内部滚动 */
            border: 1px solid var(--vscode-sideBar-border);
            border-radius: 4px;
            background: var(--vscode-list-background);
        }
        #sort-list {
            list-style: none;
        }
        #sort-list li {
            padding: 10px 12px;
            border-bottom: 1px solid var(--vscode-sideBar-border);
            font-size: 12px;
            word-break: break-all;
            cursor: grab;
        }
        #sort-list li:active {
            cursor: grabbing;
        }
        #sort-list li:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .empty-tip {
            padding: 30px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
    </style>
    <script src="${sorttableurl}"></script>
</head>
<body>
    <!-- 上方：只读JSON预览 -->
    <div class="panel top-panel">
        <div class="panel-title">Current OBJS.json (Read Only)</div>
        <div id="json-preview"></div>
    </div>

    <!-- 下方：拖拽调整链接顺序 -->
    <div class="panel bottom-panel">
        <div class="panel-title">Drag to adjust link order (Auto save after dragging)</div>
        <div class="sort-wrap">
            <ul id="sort-list"></ul>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const initObjs = ${initObjsList};
        const jsonPreviewDom = document.getElementById('json-preview');
        const listWrap = document.getElementById('sort-list');
        let sortInstance = null;

        // Render draggable list
        function renderList(list) {
            listWrap.innerHTML = '';
            if (!list || list.length === 0) {
                listWrap.innerHTML = '<li class="empty-tip">No .o files available</li>';
                return;
            }
            list.forEach(item => {
                const li = document.createElement('li');
                li.innerText = item;
                listWrap.appendChild(li);
            });

            // Destroy old instance and recreate Sortable drag
            if (sortInstance) sortInstance.destroy();
            sortInstance = new Sortable(listWrap, {
                animation: 120,
                onEnd: function () {
                    // Trigger update & save after drag ends
                    handleSortChange();
                }
            });
        }

        // Real-time refresh left JSON panel
        function updateJsonView(list) {
            const jsonStr = JSON.stringify({ OBJS: list }, null, 4);
            jsonPreviewDom.innerText = jsonStr;
        }

        // Get latest order, sync UI, notify extension to save file
        function handleSortChange() {
            const items = Array.from(listWrap.querySelectorAll('li'));
            const newObjsList = items
                .filter(li => !li.classList.contains('empty-tip'))
                .map(li => li.innerText.trim());
            
            updateJsonView(newObjsList);
            vscode.postMessage({
                type: 'save-objs-json',
                data: newObjsList
            });
        }

        // Page initialize
        updateJsonView(initObjs);
        renderList(initObjs);
    </script>
</body>
</html>
    `;
}