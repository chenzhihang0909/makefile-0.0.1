import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import * as path from 'path';
let cflags: string[] = []
let clink: string[] = []

// 单个构建模式：Debug / Release 内部结构
interface BuildModeItem {
    Include_Exclude: string[];
    Target: {
        ISA: {
            rvi: boolean;
            rvm: boolean;
            rva: boolean;
            zicsr: boolean;
            zifencei: boolean;
            zfinx: boolean;
            zicond: boolean;
            zb: boolean;
            zc: boolean;
            zmmul: boolean;
            smrnmi: boolean;
            xwingza: boolean;
            xinstend: boolean;
        };
        ABI: string;
        endian: string;
        optLevel: string;
        funcSec: boolean;
        dataSec: boolean;
        noinline: boolean;
        disableBuiltin: boolean;
        debugLevel: string;
        otherFlags: string;
    };
    Assembler: {
        definedSymbols: string[];
        incudePath: string[];
        otherFlags: string;
    };
    Compiler: {
        langStd: string;
        definedSymbols: string[];
        incudePath: string[];
        otherFlags: string;
    };
    Linker: {
        scriptFile: string[];
        lib: string[];
        libSearchPath: string[];
        noStartFiles: boolean;
        noDefaultLibs: boolean;
        noStdLib: boolean;
        gcSections: boolean;
        printGcSections: boolean;
        otherFlags: string;
    };
    NM: any;
    Readelf: any;
    Objdump: any;
    Objcopy: any;
    Size: any;
    Misc: any;
}

// 顶层完整setting.json结构
interface SettingConfig {
    Core: {
        path: string;
        version: string;
        device: string;
        baseCore: string;
        vendor: string;
        core: string;
    };
    ActiveConfigure: string;
    BuildConfig: Record<string, BuildModeItem>;
    IA_Simulator: any;
    CA_Simulator: any;
    Profiler: any;
    OpenOCD: any;
    Debugger: any;
    Flash: any;
    SVD: any;
}

export async function handleBatchGenerateMk(selectedFolderUri: string, targetArgs: { flag: boolean, args?: string, LDFLAGS?: string[] }) {
    try {
        console.log('Selected folder URI:', selectedFolderUri);
        const selectedFolderAbsPath = selectedFolderUri;
        const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
        console.log('Project root directory:', workspaceRoot);
        const outputRoot = path.join(selectedFolderAbsPath, 'output');
        const selectedFolderName = path.basename(selectedFolderAbsPath);

        // 1. Read and parse setting.json configuration
        const settingJsonPath = path.join(selectedFolderAbsPath, 'config', 'setting.json');
        const projectJsonPath = path.join(selectedFolderAbsPath, 'config', 'project.json');
        let settingConfig: SettingConfig;
        let projectConfig: any
        try {
            const settingJsonContent = await fs.readFile(settingJsonPath, 'utf8');
            const projectConfigContent = await fs.readFile(projectJsonPath, 'utf8');
            settingConfig = JSON.parse(settingJsonContent) as SettingConfig;
            projectConfig = JSON.parse(projectConfigContent)
        } catch (err) {
            vscode.window.showErrorMessage(`config/setting.json failed to parse: ${(err as Error).message}`);
            return;
        }
        if (projectConfig.type === 'RISCAL') {
            return
        }

        // 获取激活构建配置
        const activeConfigKey = settingConfig.ActiveConfigure;
        const activeMode = settingConfig.BuildConfig[activeConfigKey];
        if (!activeMode) {
            vscode.window.showErrorMessage(`未找到激活配置：${activeConfigKey}，BuildConfig内不存在该配置项`);
            return;
        }

        // 批量创建output下所有构建模式文件夹
        const allBuildModes = Object.keys(settingConfig.BuildConfig);
        for (const modeName of allBuildModes) {
            const modeDir = path.join(outputRoot, modeName);
            await fs.mkdir(modeDir, { recursive: true });
        }
        // 当前激活模式专属根目录
        const modeOutputRoot = path.join(outputRoot, activeConfigKey);

        // 2. Parse Include_Exclude array
        const excludePaths = (activeMode.Include_Exclude || []).map(item => {
            const parts = item.split(':');
            return parts.length === 2 ? parts[1].trim() : item.trim();
        }).map(excludePath => {
            return path.resolve(workspaceRoot, excludePath).replace(/\\/g, '/');
        });

        // 3. 扫描源文件过滤output目录
        const allTargetFilePaths = path.join(selectedFolderAbsPath, '**/*.@(c|cpp|s|S)');
        let allCFilePaths = glob.sync(allTargetFilePaths, { windowsPathsNoEscape: true });
        const normalizedOutputRoot = path.resolve(outputRoot).replace(/\\/g, '/');
        allCFilePaths = allCFilePaths.filter(cFilePath => {
            const normalizedCFilePath = path.resolve(cFilePath).replace(/\\/g, '/');
            if (normalizedCFilePath.startsWith(normalizedOutputRoot + '/')) {
                return false;
            }
            return !excludePaths.some(excludePath => {
                return normalizedCFilePath === excludePath || normalizedCFilePath.startsWith(`${excludePath}/`);
            });
        });

        if (allCFilePaths.length === 0) {
            vscode.window.showWarningMessage(`No valid source files found in the selected folder (${selectedFolderName})! ${excludePaths.length} paths excluded.`);
            return;
        }

        // 4. 生成subdir.mk，全部放到modeOutputRoot下
        const dirToCFilesMap = new Map<string, string[]>();
        const subMkPaths: string[] = [];
        allCFilePaths.forEach(cFilePath => {
            const cFileDir = path.dirname(cFilePath);
            if (!dirToCFilesMap.has(cFileDir)) {
                dirToCFilesMap.set(cFileDir, []);
            }
            dirToCFilesMap.get(cFileDir)!.push(cFilePath);
        });

        let currentValidObjs: string[] = [];
        for (const [cFileDir, cFiles] of dirToCFilesMap) {
            const dirRelToSelected = path.relative(selectedFolderAbsPath, cFileDir).replace(/\\/g, '/');
            // subdir.mk输出路径改为modeOutputRoot
            const targetMkDir = path.join(modeOutputRoot, dirRelToSelected);
            const mkFilePath = path.join(targetMkDir, 'subdir.mk');

            await fs.mkdir(targetMkDir, { recursive: true });
            // 传入activeConfigKey用于拼接obj路径
            const { mkContent, objs } = generateSubMkContent(cFiles, workspaceRoot, cFileDir, selectedFolderName, activeConfigKey);

            if (objs.length > 0) {
                currentValidObjs = [...currentValidObjs, ...objs];
            }

            await fs.writeFile(mkFilePath, mkContent, 'utf8');
            // 子mk相对路径基于modeOutputRoot
            const subMkRelPath = path.relative(modeOutputRoot, mkFilePath).replace(/\\/g, '/');
            subMkPaths.push(subMkRelPath);
        }

        // ===================== 改动：OBJS.json 与 makefile 同级 =====================
        const objsJsonPath = path.join(modeOutputRoot, 'OBJS.json');
        const oldObjs = await readExistObjsJson(objsJsonPath);
        const mergedObjs = mergeObjsList(oldObjs, currentValidObjs);

        let finalObjs: string[];
        if (oldObjs.length === 0) {
            finalObjs = sortObjsList(mergedObjs);
        } else {
            finalObjs = mergedObjs;
        }
        await fs.writeFile(objsJsonPath, JSON.stringify({ OBJS: finalObjs }, null, 4), 'utf8');

        // 5. 主makefile生成到当前模式目录
        const mainMakefilePath = path.join(modeOutputRoot, 'makefile');
        const mainMakefileContent = generateMainMakefileContent(
            settingConfig,
            activeMode,
            workspaceRoot,
            subMkPaths,
            selectedFolderName,
            excludePaths,
            targetArgs,
            activeConfigKey,
            modeOutputRoot
        );
        await fs.writeFile(mainMakefilePath, mainMakefileContent, 'utf8');

        vscode.window.showInformationMessage(`makefile updated successfully! Active config: ${activeConfigKey}`);

    } catch (err) {
        const errorMsg = (err as Error).message;
        console.error('Generation failed details：', err);
        vscode.window.showErrorMessage(`生成失败：${errorMsg}`);
    }
}

export async function removeGenerateMK(selectedFolderUri: string) {
    console.log('Selected folder URI:', selectedFolderUri);
    const selectedFolderAbsPath = selectedFolderUri;
    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    console.log('Project root directory:', workspaceRoot);

    const outputRoot = path.join(selectedFolderAbsPath, 'output');
    console.log('Target output directory:', outputRoot);

    try {
        await deleteFilesRecursively(outputRoot, ['.o', '.d']);
    } catch (err) {
        console.error('删除失败：', err);
    }
}

async function deleteFilesRecursively(dir: string, exts: string[]) {
    try {
        await fs.access(dir);
    } catch {
        console.log('目录不存在，跳过：', dir);
        return;
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            await deleteFilesRecursively(fullPath, exts);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (exts.includes(ext)) {
                console.log('删除文件：', fullPath);
                await fs.unlink(fullPath);
            }
        }
    }
}

// 新增参数 activeModeKey 用于拼接obj输出路径
function generateSubMkContent(
    targetFiles: string[],
    workspaceRoot: string,
    cFileDir: string,
    selectedFolderName: string,
    activeModeKey: string
): { mkContent: string, objs: string[] } {
    const cFiles: string[] = [];
    const sFiles: string[] = [];

    targetFiles.forEach(filePath => {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.c') {
            cFiles.push(filePath);
        } else if (ext === '.s') {
            sFiles.push(filePath);
        }
    });

    let mkContent = `################################################################################
# Automatically-generated file. Do not edit!
# Subdirectory: ${path.relative(workspaceRoot, cFileDir)}
# Build Mode: ${activeModeKey}
# Note: Files/directories configured in Include_Exclude (setting.json) have been excluded
################################################################################

`;
    let objs: string[] = []

    // C_SRCS 源文件路径不变
    mkContent += `# Source file list in this directory (excluded files filtered)
C_SRCS += \\\n`;
    if (cFiles.length === 0) {
        mkContent += '\n';
    } else {
        cFiles.forEach((filePath, index) => {
            const relToRoot = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const parts = relToRoot.split('/');
            parts.shift();
            const cleanPath = parts.join('/');
            const finalPath = `${workspaceRoot}/${selectedFolderName}/` + cleanPath;
            const lineEnd = index === cFiles.length - 1 ? '\n\n' : ' \\\n';
            mkContent += `\t${finalPath}${lineEnd}`;
        });
    }

    // S_SRCS 源文件路径不变
    mkContent += `# Assembly source file list in this directory (excluded files filtered)
S_SRCS += \\\n`;
    if (sFiles.length === 0) {
        mkContent += '\n';
    } else {
        sFiles.forEach((filePath, index) => {
            const relToRoot = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const parts = relToRoot.split('/');
            parts.shift();
            const cleanPath = parts.join('/');
            const finalPath = `${workspaceRoot}/${selectedFolderName}/` + cleanPath;
            const lineEnd = index === sFiles.length - 1 ? '\n\n' : ' \\\n';
            mkContent += `\t${finalPath}${lineEnd}`;
        });
    }

    // OBJS：输出路径增加模式文件夹 output/${activeModeKey}/
    const allObjFiles = [...cFiles, ...sFiles];
    mkContent += `# Object files in this directory (excluded files filtered)
OBJS += \\\n`;
    if (allObjFiles.length === 0) {
        mkContent += '\n';
    } else {
        allObjFiles.forEach((filePath, index) => {
            const relToRoot = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const parts = relToRoot.split('/');
            parts.shift();
            const cleanPath = parts.join('/');
            // obj 放入对应模式子目录
            const objFullPath = `${workspaceRoot}/${selectedFolderName}/output/${activeModeKey}/` + cleanPath.replace(/\.[cS]$/i, '.o');
            objs.push(objFullPath);
            const lineEnd = index === allObjFiles.length - 1 ? '\n\n' : ' \\\n';
            mkContent += `\t${objFullPath}${lineEnd}`;
        });
    }

    // C_DEPS 依赖文件同步放入模式子目录
    mkContent += `# Dependency files in this directory (excluded files filtered)
C_DEPS += \\\n`;
    if (cFiles.length === 0) {
        mkContent += '\n';
    } else {
        cFiles.forEach((filePath, index) => {
            const relToRoot = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const parts = relToRoot.split('/');
            parts.shift();
            const cleanPath = parts.join('/');
            const depFullPath = `${workspaceRoot}/${selectedFolderName}/output/${activeModeKey}/` + cleanPath.replace(/\.[c]$/i, '.d');
            const lineEnd = index === cFiles.length - 1 ? '\n' : ' \\\n';
            mkContent += `\t${depFullPath}${lineEnd}`;
        });
    }

    return { mkContent, objs };
}

/**
 * Generate main Makefile content
 * @param settingConfig 顶层完整配置
 * @param activeMode 当前激活Build配置
 * @param activeConfigKey 激活模式名 Debug/Release
 * @param modeOutputRoot output/模式名 绝对路径
 */
function generateMainMakefileContent(
    settingConfig: SettingConfig,
    activeMode: BuildModeItem,
    workspaceRoot: string,
    subMkPaths: string[],
    selectedFolderName: string,
    excludePaths: string[],
    targetArgs: { flag: boolean, args?: string, LDFLAGS?: string[] },
    activeConfigKey: string,
    modeOutputRoot: string
): string {
    const coreConfig = settingConfig.Core;
    const compilerConfig = activeMode.Compiler;
    const linkerConfig = activeMode.Linker;

    if (targetArgs.flag) {
        let list: string[] = []
        targetArgs.args?.split(' ').filter(Boolean).forEach((item) => {
            list.push(item)
        })
        cflags = list
        const ldlist: string[] = targetArgs.LDFLAGS?.map(path => {
            return path
                .replace('${workspaceFolder}', workspaceRoot)
                .replace('$(PROEJECTNAME)', selectedFolderName)
                .replace('$(VENDOR)', coreConfig.vendor)
                .replace('$(CORE)', coreConfig.device);
        }) || []
        clink = ldlist
    }

    // 头文件包含路径替换
    const includePaths = compilerConfig.incudePath.map(path => {
        return path
            .replace('$(TOOLCHAINS)/llvm/include', `${coreConfig.path}/llvm/include`)
            .replace('${workspaceFolder}', workspaceRoot)
            .replace('$(PROEJECTNAME)', selectedFolderName)
            .replace('$(VENDOR)', coreConfig.vendor)
            .replace('$(CORE)', coreConfig.device);
    }).map(incPath => `-I${incPath}`);

    // 拼接subdir.mk引入（相对当前makefile目录）
    let includeSubMk = '';
    let appPath = '';
    const otherPaths: string[] = [];
    subMkPaths.forEach(subMk => {
        if (subMk.includes('Application/subdir.mk')) {
            appPath = subMk;
            includeSubMk += `include ${appPath}\n`;
        } else {
            otherPaths.push(subMk);
        }
    });
    otherPaths.forEach((subMk) => {
        includeSubMk += `include ${subMk}\n`;
    });

    const targetFileName = `${selectedFolderName}.riscv`;
    // 最终elf目标放入当前模式文件夹
    const fullTargetPath = `${workspaceRoot}/${selectedFolderName}/output/${activeConfigKey}/${targetFileName}`;

    // asm过滤逻辑不变
    const asmFileDir = `${workspaceRoot}/${selectedFolderName}/Device/${coreConfig.vendor}/${coreConfig.device}/Source/GCC/`;
    let asmExcludeFilter = '';
    if (excludePaths.length > 0) {
        const excludeAsmPaths = excludePaths
            .filter(excludePath => excludePath.endsWith('.S') || excludePath.startsWith(`${asmFileDir.replace(/\\/g, '/')}`))
            .map(excludePath => {
                const relPath = path.relative(asmFileDir, excludePath).replace(/\\/g, '/');
                return relPath === '' ? '*' : relPath;
            });
        if (excludeAsmPaths.length > 0) {
            asmExcludeFilter = `\\\n    $(filter-out ${excludeAsmPaths.join(' ')}, $(_S_SRCS))`;
        }
    }

    const makefileContent = `# ************************ Auto-Generated Makefile ************************
# Dynamically generated from config/setting.json, DO NOT EDIT MANUALLY!
# Generated time: ${new Date().toLocaleString()}
# Target project: ${selectedFolderName}
# Active Build Mode: ${settingConfig.ActiveConfigure}
# Excluded paths: ${excludePaths.join('; ')}
# *********************************************************************

# Basic configuration
CC = ${coreConfig.path}/llvm/bin/clang
WORKSPACE = ${workspaceRoot}
# 当前模式专属输出目录
OUTPUT_DIR = ${workspaceRoot}/${selectedFolderName}/output/${activeConfigKey}
# 最终目标文件存放在当前模式目录
TARGET = ${fullTargetPath}
PROJECT_ROOT = ${workspaceRoot}/${selectedFolderName}

# OBJS.json 和 makefile 同级，直接读取
OBJS_JSON := ./OBJS.json
OBJS := $(shell awk -F'"' '/".*\\.o"/{print $$2}' $(OBJS_JSON) | tr '\\n' ' ')

# Compilation flags
CFLAGS = \\
    ${cflags.join(' \\\n    ')} \\

INCLUDES = \\
    ${includePaths.join(' \\\n    ')}

# 编译输出到当前模式目录
$(OUTPUT_DIR)/%.o: $(PROJECT_ROOT)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

$(OUTPUT_DIR)/%.o: $(PROJECT_ROOT)/%.S
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

-include $(C_DEPS)

# Linker flags
LDFLAGS = \\
    ${clink.join(' \\\n    ')}


# Build rules
all: $(TARGET)

$(TARGET): $(OBJS)
	@mkdir -p $(OUTPUT_DIR)
	$(CC) $(OBJS) $(LDFLAGS) -o $@

.PHONY: removeTarget
removeTarget:
\trm -rf $(TARGET)

.PHONY: clean
clean:
\trm -rf $(TARGET)
\trm -f $(OUTPUT_DIR)/*.o
\trm -f $(OUTPUT_DIR)/*.d
\trm -f $(OUTPUT_DIR)/*.lst
\trm -f $(OUTPUT_DIR)/*.hex
\tfind $(OUTPUT_DIR) -name "*.o" -delete
\tfind $(OUTPUT_DIR) -name "*.d" -delete

# Debug print rule
.PHONY: print
print:
\t@echo "=== Configuration parsed from setting.json ==="
\t@echo "Active Build Mode: ${settingConfig.ActiveConfigure}"
\t@echo "Compiler path: $(CC)"
\t@echo "Output Dir: $(OUTPUT_DIR)"
\t@echo "Target file: $(TARGET)"
\t@echo "Excluded paths: ${excludePaths.join('; ')}"
\t@echo "Valid C files count: $(words $(C_SRCS))"
\t@echo "Valid assembly files count: $(words $(S_SRCS))"
\t@echo "=== Check critical files ==="
\t@if [ -f "${clink[0]?.replace('-T', '')}" ]; then \\
\t\techo "✅ Linker script exists"; \\
\telse \\
\t\techo "❌ Linker script not found, please check the path!"; \\
\tfi
`;

    return makefileContent;
}

async function readExistObjsJson(jsonPath: string): Promise<string[]> {
    try {
        const raw = await fs.readFile(jsonPath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data?.OBJS)) {
            return data.OBJS;
        }
        return [];
    } catch {
        return [];
    }
}

function mergeObjsList(oldObjs: string[], currentValidObjs: string[]): string[] {
    const remainOld = oldObjs.filter(item => currentValidObjs.includes(item));
    const newAdd = currentValidObjs.filter(item => !remainOld.includes(item));
    const sortedNewItems = sortObjsList(newAdd);
    return [...remainOld, ...sortedNewItems];
}

function sortObjsList(list: string[]): string[] {
    return list.sort((a, b) => {
        const aIsApp = a.includes('/Application/');
        const bIsApp = b.includes('/Application/');
        if (aIsApp && !bIsApp) return -1;
        if (!aIsApp && bIsApp) return 1;
        return a.localeCompare(b);
    });
}