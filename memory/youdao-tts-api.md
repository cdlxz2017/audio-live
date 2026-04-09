# 有道智云·语音合成 API

## 基本信息

| 项目 | 值 |
|------|-----|
| 服务名称 | 语音合成 (TTS) |
| API URL | `https://openapi.youdao.com/ttsapi` |
| 请求方法 | POST |
| 字符编码 | UTF-8 |
| 响应格式 | 二进制音频文件 (Content-Type: audio/mp3) |
| 文本长度限制 | UTF-8 编码不超过 2048 字节 |

---

## 认证参数（均必填）

| 参数 | 类型 | 说明 |
|------|------|------|
| appKey | text | 应用 ID |
| salt | text | UUID，唯一通用识别码 |
| sign | text | 签名，SHA256 计算 |
| signType | text | 固定值 `v3` |
| curtime | text | 时间戳（秒） |

---

## 业务参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| q | text | ✅ | - | 待合成文本（UTF-8 ≤ 2048字节） |
| voiceName | text | ✅ | - | 发音人名称（见下方列表） |
| format | text | ❌ | mp3 | 目标音频格式，支持 mp3/pcm/wav |
| speed | text | ❌ | 1 | 语速，范围 0.5~2.0（1.0为正常速度） |
| volume | text | ❌ | 1.00 | 音量，范围 0.5~5.0 |

---

## 签名算法

```
signType = v3
input = q前10字符 + q长度 + q后10字符  （当 q.length > 20）
input = q字符串                          （当 q.length ≤ 20）
sign = SHA256(应用ID + input + salt + curtime + 应用密钥)
```

**注意事项：**
- 生成签名时 `q` **不需要** URL encode
- 发送 HTTP 请求时 `q` **需要** URL encode
- salt 建议使用 UUID

---

## 发音人列表（部分）

| 中文名 | voiceName参数 | 性别 | 语种 | 计费分类 |
|--------|-------------|------|------|----------|
| 有小智 | youxiaozhi | 男 | 中文 | 常见语种 |
| 有小薰 | youxiaoxun | 女 | 中文 | 常见语种 |
| 有小沁 | youxiaoqin | 女 | 中文 | 常见语种 |
| 有小芙 | youxiaofu | 女 | 中文 | 常见语种 |
| 有雨婷 | youyuting | 女 | 中文 | 常见语种 |
| 有小浩 | youxiaohao | 男 | 中文 | 常见语种 |
| 有小楠 | youxiaonan | 男 | 中文 | 常见语种 |
| 有小课 | youxiaoke | 男 | 中文（支持讲题/公示朗读） | 常见语种 |
| 有小美 | youxiaomei | 女 | 英文/美式 | 常见语种 |
| 有小英 | youxiaoying | 女 | 英文/英式 | 常见语种 |
| Saila | Saila | 女 | 英文/英式 | 常见语种 |
| 有可酱 | youkejiang | 女 | 日文 | 常见语种 |
| 朴智幼 | piaozhiyou | 女 | 韩文 | 常见语种 |
| 薇粤粤 | weiyueyue | 女 | 粤语 | 非常见语种 |
| youxiaobei | youxiaobei | 女 | 中文 | 常见语种 |
| youxiaodao | youxiaodao | 女 | 英文/美式 | 常见语种 |

**注意：** weixiaomei / weixiaoying 支持 pcm/wav 格式

---

## 常见错误代码

| 错误码 | 含义 |
|--------|------|
| 101 | 缺少必填参数 |
| 102 | 不支持的语言类型 |
| 108 | 应用ID无效 |
| 202 | 签名校验失败（最常见，需排查签名算法） |
| 2004 | 合成字符过长 |
| 2006 | 不支持的发音类型 |
| 2008 | 不支持的语速范围 |
| 2013 | voiceName 参数错误 |
| 2411 | 访问频率受限 |
| 2412 | 超过最大请求字符数（limit 2048 bytes） |

---

## 服务配置

- 每小时最大查询次数：3000
- 计费：按调用次数，有常见语种/非常见语种之分
