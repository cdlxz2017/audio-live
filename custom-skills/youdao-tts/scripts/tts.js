#!/usr/bin/env node
/**
 * 有道TTS (Text-to-Speech) 脚本
 * 用法: node tts.js "要转换的文字" [语言] [输出文件]
 * 语言: zh-CHS(中文), en(英语), ja(日语), ko(韩语), fr(法语), de(德语), ru(俄语), es(西班牙语)
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const APP_KEY = process.env.YOUDAO_APP_KEY || '7e204efbc4c127a5';
const APP_SECRET = process.env.YOUDAO_APP_SECRET || 'Htf7xPB0ANwZi2JBfZ3xqwkLCu7YMtIg';
const TTS_HOST = 'openapi.youdao.com';
const TTS_PATH = '/ttsapi';

const LANG_MAP = {
  'zh': 'zh-CHS', 'chs': 'zh-CHS', 'chinese': 'zh-CHS',
  'en': 'en', 'english': 'en',
  'ja': 'ja', 'japanese': 'ja',
  'ko': 'ko', 'korean': 'ko',
  'fr': 'fr', 'french': 'fr',
  'de': 'de', 'german': 'de',
  'ru': 'ru', 'russian': 'ru',
  'es': 'es', 'spanish': 'es'
};

/**
 * 生成有道 API v3 签名
 */
function makeSign(q, secret) {
  const salt = Date.now().toString();
  const curtime = Math.floor(Date.now() / 1000).toString();
  const inputStr = q.length > 20 ? q.substring(0, 10) + q.length + q.substring(q.length - 10) : q;
  const signStr = APP_KEY + inputStr + salt + curtime + secret;
  return {
    salt, curtime,
    sign: crypto.createHash('sha256').update(signStr).digest('hex').toUpperCase()
  };
}

/**
 * 调用有道TTS API
 * @returns {Promise<Buffer>} MP3音频数据
 */
function tts(text, lang = 'zh-CHS') {
  return new Promise((resolve, reject) => {
    const langType = LANG_MAP[lang.toLowerCase()] || lang;
    const { salt, curtime, sign } = makeSign(text, APP_SECRET);

    const params = new URLSearchParams({
      q: text,
      langType: langType,
      appKey: APP_KEY,
      salt: salt,
      curtime: curtime,
      signType: 'v3',
      sign: sign,
      format: 'mp3'
      // 注意：不指定 voice 参数，使用API默认值
    });

    const options = {
      hostname: TTS_HOST,
      path: TTS_PATH + '?' + params.toString(),
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';

        if (ct.includes('audio') || ct.includes('mp3')) {
          resolve(buf); // 返回原始MP3数据
        } else {
          // 解析错误JSON
          try {
            const json = JSON.parse(buf.toString());
            reject(new Error(`有道TTS错误: ${json.errorCode} - ${json.requestId}`));
          } catch (e) {
            reject(new Error(`有道TTS错误: 非音频响应 (${ct}), 大小=${buf.length}`));
          }
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// 主入口
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法: node tts.js "要转换的文字" [语言] [输出文件]');
    console.log('示例: node tts.js "你好世界" zh /tmp/output.mp3');
    process.exit(1);
  }

  const text = args[0];
  const lang = args[1] || 'zh-CHS';
  const outputPath = args[2] || null;

  try {
    console.error(`🎤 正在合成: "${text}" (语言: ${lang})`);
    const mp3Buffer = await tts(text, lang);

    if (outputPath) {
      fs.writeFileSync(outputPath, mp3Buffer);
      console.error(`✅ TTS成功: ${outputPath} (${mp3Buffer.length} bytes)`);
      console.log(outputPath);
    } else {
      // 输出base64到stdout
      const base64 = mp3Buffer.toString('base64');
      process.stdout.write(base64);
    }
  } catch (err) {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  }
}

main();
