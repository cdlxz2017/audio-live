#!/usr/bin/env node
/**
 * 任务路由代理脚本
 * 用法: node delegate.js <模型> <任务类型> [参数...]
 * 
 * 模型别名:
 *   minimax-text  → MiniMax 文本对话
 *   minimax-tts  → MiniMax TTS
 *   youdao-tts   → Youdao TTS
 *   youdao-asr   → Youdao ASR
 *   edge-tts      → Edge-TTS (免费)
 *   whisper       → Ollama Whisper (本地)
 * 
 * 任务类型:
 *   chat         → 文本对话
 *   tts           → 语音合成
 *   asr           → 语音识别
 *   translate     → 翻译
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============ 凭证 ============
const CREDS = {
  minimax: 'sk-cp-6fK-TWGeJV1NhnYfmtiTeghLHfbaiT_h53vs4LdPqSKCIXiybOmPNTDXhCeK1cjfRebRGDfV4eOJMn9MuCWcamUmD4J8RAoLOIWeM7e12rbG-f3wMRECpnM',
  youdao_app_key: '28eb4e39cf5a208c',
  youdao_app_secret: 'ZhLRUFkIl2IGr1z4Ck41ocVEl2pMBE2b',
};

// ============ Youdao TTS ============
function youdaoTTS(text, lang = 'zh-CHS', outputPath) {
  return new Promise((resolve, reject) => {
    const crypto = require('crypto');
    const salt = Date.now().toString();
    const curtime = Math.floor(Date.now() / 1000).toString();
    const input = text.length > 20 ? text.substring(0,10)+text.length+text.substring(text.length-10) : text;
    const signStr = CREDS.youdao_app_key + input + salt + curtime + CREDS.youdao_app_secret;
    const sign = crypto.createHash('sha256').update(signStr).digest('hex').toUpperCase();

    const params = new URLSearchParams({
      q: text, langType: lang === 'zh' ? 'zh-CHS' : lang,
      appKey: CREDS.youdao_app_key, salt, curtime, signType: 'v3', sign, format: 'mp3'
    });

    const options = {
      hostname: 'openapi.youdao.com',
      path: '/ttsapi?' + params.toString(),
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.headers['content-type']?.includes('audio') || buf.length > 1000) {
          if (outputPath) {
            fs.writeFileSync(outputPath, buf);
            resolve(outputPath);
          } else {
            resolve(buf.toString('base64'));
          }
        } else {
          reject(new Error('Youdao TTS failed: ' + buf.toString().substring(0, 100)));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ============ Edge-TTS ============
function edgeTTS(text, voice = 'zh-CN-XiaoxiaoNeural', outputPath) {
  return new Promise((resolve, reject) => {
    const EDGE_TTS = '/home/ai/ocr-env/bin/edge-tts';
    if (!fs.existsSync(EDGE_TTS)) {
      // Try system edge-tts
      try {
        execSync('which edge-tts', {stdio:'pipe'});
      } catch(e) {
        return reject(new Error('Edge-TTS not found'));
      }
    }
    try {
      execSync(`${EDGE_TTS} -t "${text.replace(/"/g, '\\"')}" --write-media ${outputPath || '/tmp/edge_tts.mp3'}`, {stdio:'pipe'});
      resolve(outputPath || '/tmp/edge_tts.mp3');
    } catch(e) {
      reject(new Error('Edge-TTS failed: ' + e.message));
    }
  });
}

// ============ MiniMax 文本对话 ============
function minimaxChat(messages, model = 'MiniMax-M2.7') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ model, messages, stream: false });

    const options = {
      hostname: 'api.minimaxi.com',
      path: '/v1/text/chatcompletion_v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CREDS.minimax
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        try {
          const j = JSON.parse(buf.toString());
          if (j.data?.choices?.[0]?.messages?.[0]?.content) {
            resolve(j.data.choices[0].messages[0].content);
          } else {
            reject(new Error(JSON.stringify(j).substring(0, 200)));
          }
        } catch(e) {
          reject(new Error(buf.toString().substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ============ Ollama Whisper ASR ============
function whisperASR(audioPath) {
  return new Promise((resolve, reject) => {
    try {
      const result = execSync(
        `curl -s -X POST http://localhost:11434/api/whisper -d "{\"file\":\"${audioPath}\"}"`,
        { timeout: 30000 }
      );
      const j = JSON.parse(result.toString());
      resolve(j.text || '');
    } catch(e) {
      reject(new Error('Whisper failed: ' + e.message));
    }
  });
}

// ============ 主入口 ============
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: node delegate.js <模型> <任务类型> [参数...]');
    console.log('示例:');
    console.log('  node delegate.js youdao-tts tts "你好世界" /tmp/out.mp3');
    console.log('  node delegate.js minimax chat "你好"');
    console.log('  node delegate.js edge-tts tts "hello" /tmp/out.mp3');
    process.exit(1);
  }

  const [model, taskType, ...rest] = args;
  const text = rest[0] || '';
  const outputPath = rest[1] || null;

  try {
    console.error(`[Router] ${model}/${taskType} -> processing...`);

    if (model === 'youdao-tts' && taskType === 'tts') {
      const result = await youdaoTTS(text, rest[2] || 'zh', outputPath);
      console.log(result);

    } else if (model === 'edge-tts' && taskType === 'tts') {
      const result = await edgeTTS(text, rest[2], outputPath);
      console.log(result);

    } else if (model === 'minimax-text' && taskType === 'chat') {
      const messages = [{ role: 'user', content: text }];
      const result = await minimaxChat(messages);
      console.log(result);

    } else if (model === 'whisper' && taskType === 'asr') {
      const result = await whisperASR(text);
      console.log(result);

    } else {
      console.error(`[Router] Unknown model/task: ${model}/${taskType}`);
      process.exit(1);
    }

    console.error(`[Router] Done`);
  } catch (err) {
    console.error('[Router] Error:', err.message);
    process.exit(1);
  }
}

main();
