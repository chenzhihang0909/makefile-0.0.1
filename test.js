const axios = require('axios');
const fs = require('fs');

// 配置
const url = 'http://127.0.0.1:10240/api/compiler/riscv-clang/cmake';
const jsonPath = './test.json';
const outPath = './result.json'; // 输出文件

async function main() {
  try {
    // 1. 读取 test.json
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const { body } = JSON.parse(raw);

    // 2. 发起 POST 请求
    const res = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' }
    });

    // 3. 格式化输出并写入文件
    const output = JSON.stringify(res.data, null, 2);
    fs.writeFileSync(outPath, output, 'utf-8');
    console.log('✅ 成功，结果已写入', outPath);
  } catch (err) {
    // 错误也写入文件
    const errorInfo = {
      message: err.message,
      response: err.response?.data || null,
      status: err.response?.status || null
    };
    fs.writeFileSync(outPath, JSON.stringify(errorInfo, null, 2), 'utf-8');
    console.error('❌ 请求失败，错误已写入', outPath);
  }
}

main();