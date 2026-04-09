#!/usr/bin/env node
/**
 * 有道ASR (语音识别) 脚本
 * 用法: node asr.js <audio_file> [lang]
 * lang: zh-CHS(中文，默认), en(英语), ja(日语), ko(韩语), fr(法语), de(德语), ru(俄语), es(西班牙语)
 *
 * 凭证: openclaw02 应用
 * - APP_ID: 7e204efbc4c127a5
 * - APP_SECRET: Htf7xPB0ANwZi2JBfZ3xqwkLCu7YMtIg
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP_KEY = process.env.YOUDAO_APP_KEY || '7e204efbc4c127a5';
const APP_SECRET = process.env.YOUDAO_APP_SECRET || 'Htf7xPB0ANwZi2JBfZ3xqwkLCu7YMtIg';
const ASR_HOST = 'openapi.youdao.com';
const ASR_PATH = '/asrapi';

/**
 * 生成有道 API v3 签名
 * sign = SHA256(APP_KEY + salt + curtime + APP_SECRET)
 */
function makeSign() {
  const salt = Date.now().toString();
  const curtime = Math.floor(Date.now() / 1000).toString();
  const signStr = APP_KEY + salt + curtime + APP_SECRET;
  return {
    salt,
    curtime,
    sign: crypto.createHash('sha256').update(signStr).digest('hex').toUpperCase()
  };
}

/**
 * 将音频文件转码为 16kHz 16bit PCM（写入临时文件）
 * @param {string} audioPath 原始音频路径
 * @returns {Promise<string>} PCM 临时文件路径
 */
function convertToPcmFile(audioPath) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `youdao_asr_${Date.now()}.pcm`);
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-i', audioPath,
      '-ar', '16000', '-ac', '1',
      '-sample_fmt', 's16', '-f', 's16le',
      '-acodec', 'pcm_s16le', tmpFile
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (c) => { stderr += c.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpFile)) {
        resolve(tmpFile);
      } else {
        reject(new Error(`ffmpeg 转换失败 (code=${code}): ${stderr.substring(0, 300)}`));
      }
    });
    ffmpeg.on('error', reject);
  });
}

/**
 * 调用有道 ASR API
 * @param {string} audioPath 音频文件路径
 * @param {string} lang 语言
 */
async function asr(audioPath, lang = 'zh-CHS') {
  console.error(`[有道ASR] 正在转码: ${audioPath}`);

  // 1. 转换为 PCM 16kHz
  const pcmPath = await convertToPcmFile(audioPath);
  const fileBuffer = fs.readFileSync(pcmPath);
  console.error(`[有道ASR] PCM: ${fileBuffer.length} bytes (${(fileBuffer.length / 2 / 16000).toFixed(1)}s @ 16000Hz)`);

  // 2. 生成签名
  const { salt, curtime, sign } = makeSign();

  // 3. 构建 multipart/form-data 请求
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substr(2, 15);
  const CRLF = '\r\n';

  const formBody = Buffer.concat([
    // appKey
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="appKey"${CRLF}${CRLF}` +
      `${APP_KEY}${CRLF}`
    ),
    // langType
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="langType"${CRLF}${CRLF}` +
      `${lang}${CRLF}`
    ),
    // file (pcm)
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="audio.pcm"${CRLF}` +
      `Content-Type: audio/pcm${CRLF}${CRLF}`
    ),
    fileBuffer,
    Buffer.from(CRLF),
    // salt
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="salt"${CRLF}${CRLF}` +
      `${salt}${CRLF}`
    ),
    // curtime
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="curtime"${CRLF}${CRLF}` +
      `${curtime}${CRLF}`
    ),
    // sign
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="sign"${CRLF}${CRLF}` +
      `${sign}${CRLF}`
    ),
    // signType
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="signType"${CRLF}${CRLF}` +
      `v3${CRLF}`
    ),
    // format
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="format"${CRLF}${CRLF}` +
      `pcm${CRLF}`
    ),
    // rate
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="rate"${CRLF}${CRLF}` +
      `16000${CRLF}`
    ),
    Buffer.from(`--${boundary}--${CRLF}`)
  ]);

  // 4. 发送请求
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ASR_HOST,
      path: ASR_PATH,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formBody.length
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        try {
          const json = JSON.parse(buf.toString());
          if (json.errorCode === '0' && json.result) {
            resolve(json.result);
          } else {
            reject(new Error(`有道ASR错误: errorCode=${json.errorCode}, requestId=${json.requestId || 'N/A'}`));
          }
        } catch (e) {
          reject(new Error(`有道ASR响应解析失败: ${buf.toString().substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(formBody);
    req.end();
  }).finally(() => {
    // 清理临时文件
    try { fs.unlinkSync(pcmPath); } catch (e) {}
  });
}

// 主入口
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node asr.js <audio_file> [lang]');
    console.error('示例: node asr.js /tmp/recording.mp3 zh-CHS');
    process.exit(1);
  }

  const audioPath = args[0];
  const lang = args[1] || 'zh-CHS';

  if (!fs.existsSync(audioPath)) {
    console.error(`[有道ASR] 音频文件不存在: ${audioPath}`);
    process.exit(1);
  }

  try {
    console.error(`[有道ASR] 开始识别: ${audioPath} (语言: ${lang})`);
    const text = await asr(audioPath, lang);
    console.error(`[有道ASR] 成功: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    // 输出纯文本到 stdout
    process.stdout.write(text);
  } catch (err) {
    console.error(`[有道ASR] 失败: ${err.message}`);
    process.exit(1);
  }
}

main();
