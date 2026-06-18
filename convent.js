/**
 * 动态解析 Makefile 生成 CMakeLists.txt
 * 自动提取：项目名、编译器、编译选项、头文件、链接配置、源码目录
 * @param {string} makeContent 原始 Makefile 文本
 * @returns {string} 生成的 CMake 内容
 */
function makeToCMake(makeContent) {
  // 提取项目名 (Target project: xxx)
  const getProjectName = () => {
    const m = makeContent.match(/Target project:\s*(\w+)/);
    return m ? m[1].trim() : 'project';
  };

  // 提取编译器路径
  const getCC = () => {
    const m = makeContent.match(/CC\s*=\s*([^\n#]+)/);
    return m ? m[1].trim() : '';
  };

  // 提取编译参数 CFLAGS，过滤 -MMD -MP
  const getCFlags = () => {
    const m = makeContent.match(/CFLAGS\s*=\s*([\s\S]*?)(?=\n#|\nINCLUDES|\nLDFLAGS|\n\$\(OUTPUT_DIR\))/);
    if (!m) return [];
    return m[1]
      .replace(/\\\n/g, ' ')
      .split(/\s+/)
      .filter(s => s && s !== '-MMD' && s !== '-MP');
  };

  // 提取所有 -I 头文件路径
  const getIncludes = () => {
    const m = makeContent.match(/INCLUDES\s*=\s*([\s\S]*?)(?=\n#|\nCFLAGS|\nLDFLAGS|\n\$\(OUTPUT_DIR\))/);
    if (!m) return [];
    const paths = [];
    const reg = /-I\s*([^\s\\]+)/g;
    let res;
    while ((res = reg.exec(m[1]))) {
      paths.push(res[1].trim());
    }
    return paths;
  };

  // 提取链接参数、链接脚本、库目录
  const getLdInfo = () => {
    const m = makeContent.match(/LDFLAGS\s*=\s*([\s\S]*?)(?=\n#|\nall:|\n\$\(TARGET\))/);
    const ret = { ldFlags: [], ldScript: '', libDir: '' };
    if (!m) return ret;
    const parts = m[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean);
    let idx = 0;
    while (idx < parts.length) {
      const cur = parts[idx];
      if (cur === '-L' && idx + 1 < parts.length) {
        ret.libDir = parts[++idx];
      } else if (cur === '-T' && idx + 1 < parts.length) {
        ret.ldScript = parts[++idx];
      } else {
        ret.ldFlags.push(cur);
      }
      idx++;
    }
    return ret;
  };

  // 提取源码目录（从 include xxx/subdir.mk）
  const getSrcDirs = () => {
    const reg = /include\s+([\w/]+\/subdir\.mk)/g;
    const dirs = new Set();
    let res;
    while ((res = reg.exec(makeContent))) {
      dirs.add(res[1].replace('/subdir.mk', ''));
    }
    return Array.from(dirs);
  };

  // 统一提取所有动态变量
  const projectName = getProjectName();
  const ccPath = getCC();
  const cFlags = getCFlags();
  const incPaths = getIncludes();
  const { ldFlags, ldScript, libDir } = getLdInfo();
  const srcDirs = getSrcDirs();

  // 拼接 CMake 文本
  const lines = [];

  lines.push(`# 强制关闭编译器自检，适配交叉编译`);
  lines.push(`set(CMAKE_C_COMPILER_WORKS ON CACHE BOOL "" FORCE)`);
  lines.push(`set(CMAKE_C_COMPILER_FORCED ON)`);
  lines.push(`set(CMAKE_ASM_COMPILER_FORCED ON)`);
  lines.push('');

  lines.push(`set(CMAKE_C_COMPILER ${ccPath})`);
  lines.push(`set(CMAKE_ASM_COMPILER ${ccPath})`);
  lines.push('');

  // 项目名动态赋值
  lines.push(`cmake_minimum_required(VERSION 3.10)`);
  lines.push(`project(${projectName} C ASM)`);
  lines.push(`enable_language(ASM)`);
  lines.push('');

  lines.push(`# 编译参数`);
  lines.push(`add_compile_options(`);
  cFlags.forEach(opt => lines.push(`    ${opt}`));
  lines.push(`)`);
  lines.push('');

  lines.push(`# 头文件路径`);
  lines.push(`include_directories(`);
  incPaths.forEach(p => lines.push(`    ${p}`));
  lines.push(`)`);
  lines.push('');

  if (libDir) {
    lines.push(`# 链接库目录`);
    lines.push(`link_directories(${libDir})`);
    lines.push('');
  }

  lines.push(`# 链接参数`);
  lines.push(`add_link_options(`);
  ldFlags.forEach(opt => lines.push(`    ${opt}`));
  if (ldScript) lines.push(`    -T ${ldScript}`);
  lines.push(`    -Wl,--no-warn-mismatch`);
  lines.push(`    -Wl,--gc-sections`);
  lines.push(`)`);
  lines.push('');

  lines.push(`# 递归收集源文件`);
  lines.push(`file(GLOB_RECURSE SOURCES`);
  srcDirs.forEach(d => lines.push(`    \${PROJECT_SOURCE_DIR}/${d}/*.[cS]`));
  lines.push(`)`);
  lines.push('');

  lines.push(`add_executable(main \${SOURCES})`);

  return lines.join('\n');
}

let a = makeToCMake(`
    # ************************ Auto-Generated Makefile ************************
# Dynamically generated from config/setting.json, DO NOT EDIT MANUALLY!
# Generated time: 6/12/2026, 11:39:33 AM
# Target project: demo_130C
# Excluded paths: 
# *********************************************************************

# Basic configuration (read from setting.json)
CC = /home/chenzhihang/workspace/demo_130/output/llvm/bin/clang # Clang compiler path
WORKSPACE = /home/chenzhihang/workspace           # Project root directory
OUTPUT_DIR = /home/chenzhihang/workspace/demo_130C/output
TARGET = /home/chenzhihang/workspace/demo_130C/output/demo_130C.riscv # Dynamic target file
PROJECT_ROOT = /home/chenzhihang/workspace/demo_130C
# Include all subdirectory .mk files (excluded files filtered)
include WMSIS/Driver/Source/subdir.mk
include Device/Wingsemi/WM32AES128C100/Source/subdir.mk
include Device/Wingsemi/WM32AES128C100/Source/GCC/subdir.mk
include Application/subdir.mk


# Compilation flags CFLAGS (dynamically generated from setting.json)
CFLAGS = \
    -march=rv32ima_zicsr_zifencei_zfinx_zicond_zba_zbb_zbc_zbs_zca_zcb_zcmp_zcmt_smrnmi_xwingza_xinstend \
    -mabi=ilp32 \
    -mlittle-endian \
    -O0 \
    -fno-inline-functions \
    -fno-builtin \
    -g \
    -DPREALLOCATE=1 \
    -std=gnu89 \
    -static \
    -mstrict-align \
    -mrelax \
    -mcmodel=medlow \
    -MMD \
    -MP

INCLUDES = \
    -I/home/chenzhihang/workspace/demo_130/output/llvm/include \
    -I/home/chenzhihang/workspace/demo_130C \
    -I/home/chenzhihang/workspace/demo_130C/Application \
    -I/home/chenzhihang/workspace/demo_130C/Common \
    -I/home/chenzhihang/workspace/demo_130C/WMSIS/Core/Include \
    -I/home/chenzhihang/workspace/demo_130C/WMSIS/Driver/Include \
    -I/home/chenzhihang/workspace/demo_130C/Device/Wingsemi/WM32AES128C100/Include

$(OUTPUT_DIR)/%.o: $(PROJECT_ROOT)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

$(OUTPUT_DIR)/%.o: $(PROJECT_ROOT)/%.S
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

-include $(C_DEPS)

# Linker flags LDFLAGS (dynamically generated from setting.json)
LDFLAGS = \
    -lm \
    -L \
    /home/chenzhihang/workspace/demo_130C/Device/Wingsemi/WM32AES128C100/Source/GCC/ \
    -T \
    /home/chenzhihang/workspace/demo_130C/Device/Wingsemi/WM32AES128C100/Source/GCC/tcm.ld \
    -nostartfiles

# Build rules
all: $(TARGET)

$(TARGET): $(OBJS)
	@mkdir -p $(OUTPUT_DIR)
	$(CC) $(OBJS) $(LDFLAGS) -o $@


.PHONY: removeTarget
removeTarget:
	rm -rf $(TARGET)

.PHONY: clean
clean:
	rm -rf $(TARGET)
	rm -f $(OUTPUT_DIR)/*.o
	rm -f $(OUTPUT_DIR)/*.d
	rm -f $(OUTPUT_DIR)/*.lst
	rm -f $(OUTPUT_DIR)/*.hex
	find . -name "*.o" -delete
	find . -name "*.d" -delete

# Debug rule: print key configurations + exclusion list
.PHONY: print
print:
	@echo "=== Configuration parsed from setting.json ==="
	@echo "Compiler path: $(CC)"
	@echo "Target file: $(TARGET)"
	@echo "Excluded paths: "
	@echo "Valid C files count: $(words $(C_SRCS))"
	@echo "Valid assembly files count: $(words $(S_SRCS))"
	@echo "=== Check critical files ==="
	@if [ -f "-lm" ]; then \
		echo "✅ Linker script exists"; \
	else \
		echo "❌ Linker script not found, please check the path!"; \
	fi

    
    `)


    console.log(a)