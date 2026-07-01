import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import * as path from 'path';
let cflags: string[] = []
let clink:string[] = []
interface SettingConfig {
    Core: {
        path: string;
        version: string;
        device: string;
        baseCore: string;
        vendor: string;
        core: string;
    };
    Target: {
        vendor: string;
        device: string;
        base_core: string;
        riscal_tool_ver: string;
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
    Include_Exclude: string[]
}

export async function handleBatchGenerateMk(selectedFolderUri: string, targetArgs: { flag: boolean, args?: string }) {
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
        let projectConfig:any
        try {
            const settingJsonContent = await fs.readFile(settingJsonPath, 'utf8');
            const projectConfigContent = await fs.readFile(projectJsonPath, 'utf8');
            settingConfig = JSON.parse(settingJsonContent) as SettingConfig;
            projectConfig = JSON.parse(projectConfigContent)
        } catch (err) {
            vscode.window.showErrorMessage(`config/setting.json failed to parse: ${(err as Error).message}`);
            return;
        }
        if(projectConfig.type === 'RISCAL'){
            return
        }
        // 2. Parse Include_Exclude array, extract paths to exclude (format: "prefix:exclude path" → take the latter part)
        const excludePaths = (settingConfig.Include_Exclude || []).map(item => {
            const parts = item.split(':');
            return parts.length === 2 ? parts[1].trim() : item.trim();
        }).map(excludePath => {
            // Unify path format (convert to absolute path + standardize separators)
            return path.resolve(workspaceRoot, excludePath).replace(/\\/g, '/');
        });

        // 3. 扫描 C/CPP/ASM 文件 → 过滤排除文件（修复版）
        const allTargetFilePaths = path.join(selectedFolderAbsPath, '**/*.@(c|cpp|s|S)');
        // ✅ 关键修复：使用 glob.sync 同步获取数组，100% 可靠
        let allCFilePaths = glob.sync(allTargetFilePaths, { windowsPathsNoEscape: true });
        const normalizedOutputRoot = path.resolve(outputRoot).replace(/\\/g, '/');
        // 现在 allCFilePaths 是标准数组，可以正常使用 filter
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

        // 4. Generate subdirectory .mk files and collect paths (only include non-excluded files)
        const dirToCFilesMap = new Map<string, string[]>();
        const subMkPaths: string[] = [];
        allCFilePaths.forEach(cFilePath => {
            const cFileDir = path.dirname(cFilePath);
            if (!dirToCFilesMap.has(cFileDir)) {
                dirToCFilesMap.set(cFileDir, []);
            }
            dirToCFilesMap.get(cFileDir)!.push(cFilePath);
        });

        let successCount = 0;
        let OBJS:any = {
            OBJS:[]
        }
        for (const [cFileDir, cFiles] of dirToCFilesMap) {
            const dirRelToSelected = path.relative(selectedFolderAbsPath, cFileDir).replace(/\\/g, '/');
            const targetMkDir = path.join(outputRoot, dirRelToSelected);
            const mkFilePath = path.join(targetMkDir, 'subdir.mk');

            // Ensure directory exists (overwrite if generated before)
            await fs.mkdir(targetMkDir, { recursive: true });
            // Generate sub .mk file (only include non-excluded files)
            const {mkContent,objs} = generateSubMkContent(cFiles, workspaceRoot, cFileDir,selectedFolderName);
            
            if(objs.length>0){
                OBJS.OBJS = [...OBJS.OBJS, ...objs]
            }
            
            await fs.writeFile(mkFilePath, mkContent, 'utf8');

            const subMkRelPath = path.relative(outputRoot, mkFilePath).replace(/\\/g, '/');
            subMkPaths.push(subMkRelPath);
            successCount++;
        }
        console.log(OBJS)
        await fs.writeFile(path.join(outputRoot,'OBJS.json'), JSON.stringify(OBJS,null, 4), 'utf8');
        // 5. Dynamically generate main Makefile based on setting.json + exclusion list
        const mainMakefilePath = path.join(outputRoot, 'makefile');
        const mainMakefileContent = generateMainMakefileContent(
            settingConfig,
            workspaceRoot,
            subMkPaths,
            selectedFolderName,
            excludePaths,
            targetArgs
        );
        await fs.writeFile(mainMakefilePath, mainMakefileContent, 'utf8');

        vscode.window.showInformationMessage(`makefile updated successfully!`);

    } catch (err) {
        const errorMsg = (err as Error).message;
        // vscode.window.showErrorMessage(`❌ Error：${errorMsg}`);
        console.error('Generation failed details：', err);
    }
}
export async function removeGenerateMK(selectedFolderUri: string) {
    console.log('Selected folder URI:', selectedFolderUri);
    const selectedFolderAbsPath = selectedFolderUri;
    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
    console.log('Project root directory:', workspaceRoot);

    // 拼接 output 目录
    const outputRoot = path.join(selectedFolderAbsPath, 'output');
    console.log('Target output directory:', outputRoot);

    try {
        // 递归删除所有 .o 和 .d 文件
        await deleteFilesRecursively(outputRoot, ['.o', '.d']);
    } catch (err) {
        console.error('删除失败：', err);
    }
}
async function deleteFilesRecursively(dir: string, exts: string[]) {
    try {
        // 检查目录是否存在
        await fs.access(dir);
    } catch {
        console.log('目录不存在，跳过：', dir);
        return;
    }

    // 读取目录下所有内容
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            // 递归子目录
            await deleteFilesRecursively(fullPath, exts);
        } else if (entry.isFile()) {
            // 判断后缀是否需要删除
            const ext = path.extname(entry.name);
            if (exts.includes(ext)) {
                console.log('删除文件：', fullPath);
                await fs.unlink(fullPath);
            }
        }
    }
}
function generateSubMkContent(
    targetFiles: string[],
    workspaceRoot: string,
    cFileDir: string,
    selectedFolderName: string
): {mkContent:string, objs:any[]} {
    // 拆分 C 文件 和 S 文件
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
# Note: Files/directories configured in Include_Exclude (setting.json) have been excluded
################################################################################

`;
let objs:any = []

    // ------------------------------
    // 生成 C_SRCS
    // ------------------------------
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

    // ------------------------------
    // 生成 S_SRCS
    // ------------------------------
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

    // ------------------------------
    // 生成 OBJS（C + S 都生成 .o）
    // ------------------------------
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
            const finalPath = `${workspaceRoot}/${selectedFolderName}/output/` + cleanPath.replace(/\.[cS]$/i, '.o');
            objs.push(finalPath)
            const lineEnd = index === allObjFiles.length - 1 ? '\n\n' : ' \\\n';
            mkContent += `\t${finalPath}${lineEnd}`;
        });
    }

    // ------------------------------
    // 生成 C_DEPS（只给 C 文件）
    // ------------------------------
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
            const finalPath = `${workspaceRoot}/${selectedFolderName}/` + cleanPath.replace(/\.[c]$/i, '.d');
            const lineEnd = index === cFiles.length - 1 ? '\n' : ' \\\n';
            mkContent += `\t${finalPath}${lineEnd}`;
        });
    }

    return {mkContent, objs:objs};
}

/**
 * Generate main Makefile content (include all sub .mk + full compilation configuration)
 * @param testFolderPath Test folder path
 * @param workspaceRoot Project root directory
 * @param subMkPaths List of all sub .mk file paths relative to test/output
 */
function generateMainMakefileContent(
    settingConfig: SettingConfig,
    workspaceRoot: string,
    subMkPaths: string[],
    selectedFolderName: string,
    excludePaths: string[],
    targetArgs: { flag: boolean, args?: string,LDFLAGS?:string[] }
): string {
    // 1. Parse core configuration
    const coreConfig = settingConfig.Core;
    const compilerConfig = settingConfig.Compiler;


    // 3. Concatenate compilation flags


    if (targetArgs.flag) {
        let list: string[] = []
        targetArgs.args?.split(',').map((item) => {
            list.push(item)
        })
        cflags = list
        const ldlist:any = targetArgs.LDFLAGS?.map(path => {
            return path
                .replace('${workspaceFolder}', workspaceRoot)
                .replace('$(PROEJECTNAME)', selectedFolderName)
                .replace('$(VENDOR)', coreConfig.vendor)
                .replace('$(CORE)', coreConfig.device);
        })
        clink = ldlist
    }

    // 5. Concatenate header file paths
    const includePaths = compilerConfig.incudePath.map(path => {
        return path
            .replace('$(TOOLCHAINS)/llvm/include', `${coreConfig.path}/llvm/include`)
            .replace('${workspaceFolder}', workspaceRoot)
            .replace('$(PROEJECTNAME)', selectedFolderName)
            .replace('$(VENDOR)', coreConfig.vendor)
            .replace('$(CORE)', coreConfig.device);
    }).map(incPath => `-I${incPath}`);
    

    // 7. Concatenate sub .mk include statements
    let includeSubMk = '';
    subMkPaths.forEach(subMk => {
        includeSubMk += `include ${subMk}\n`;
    });

    // 8. Dynamic target filename
    const targetFileName = `${selectedFolderName}.riscv`;

    // 9. Generate assembly file filter logic (exclude assembly files in excludePaths)
    const asmFileDir = `${workspaceRoot}/${selectedFolderName}/Device/${coreConfig.vendor}/${coreConfig.device}/Source/GCC/`;
    // Concatenate excluded assembly files Makefile filter rules
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

    // 10. Concatenate final Makefile content (include exclusion list description)
    const makefileContent = `# ************************ Auto-Generated Makefile ************************
# Dynamically generated from config/setting.json, DO NOT EDIT MANUALLY!
# Generated time: ${new Date().toLocaleString()}
# Target project: ${selectedFolderName}
# Excluded paths: ${excludePaths.join('; ')}
# *********************************************************************

# Basic configuration (read from setting.json)
CC = ${coreConfig.path}/llvm/bin/clang # Clang compiler path
WORKSPACE = ${workspaceRoot}           # Project root directory
OUTPUT_DIR = ${workspaceRoot}/${selectedFolderName}/output
TARGET = ${workspaceRoot}/${selectedFolderName}/output/${targetFileName} # Dynamic target file
PROJECT_ROOT = ${workspaceRoot}/${selectedFolderName}
# Include all subdirectory .mk files (excluded files filtered)
${includeSubMk}

# Compilation flags CFLAGS (dynamically generated from setting.json)
CFLAGS = \\
    ${cflags.join(' \\\n    ')} \\
    -MMD \\
    -MP

INCLUDES = \\
    ${includePaths.join(' \\\n    ')}

$(OUTPUT_DIR)/%.o: $(PROJECT_ROOT)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

$(OUTPUT_DIR)/%.o: $(PROJECT_ROOT)/%.S
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

-include $(C_DEPS)

# Linker flags LDFLAGS (dynamically generated from setting.json)
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
\tfind . -name "*.o" -delete
\tfind . -name "*.d" -delete

# Debug rule: print key configurations + exclusion list
.PHONY: print
print:
\t@echo "=== Configuration parsed from setting.json ==="
\t@echo "Compiler path: $(CC)"
\t@echo "Target file: $(TARGET)"
\t@echo "Excluded paths: ${excludePaths.join('; ')}"
\t@echo "Valid C files count: $(words $(C_SRCS))"
\t@echo "Valid assembly files count: $(words $(S_SRCS))"
\t@echo "=== Check critical files ==="
\t@if [ -f "${clink[0].replace('-T', '')}" ]; then \\
\t\techo "✅ Linker script exists"; \\
\telse \\
\t\techo "❌ Linker script not found, please check the path!"; \\
\tfi
`;

    return makefileContent;
}