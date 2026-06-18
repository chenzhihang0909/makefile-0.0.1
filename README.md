# wing-studio-tips

在 .c 和 .h 文件中自动显示函数性能数据，读取 output/function.prof，在行尾展示 Calls、Selfinst、周期、占比等信息。

## 功能
- 自动识别多项目结构（D512/A310等）
- 自动读取 项目目录/output/function.prof
- 支持 .c / .h 文件
- 函数行尾显示性能数据（GitLens 风格）