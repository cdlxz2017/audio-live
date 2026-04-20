# ROCm 7.2.1 官方文档深度解读与系统适配报告

> 报告生成时间：2026-04-14
> 报告目的：为 AMD MAX 395（Strix Halo）系统提供 ROCm 7.2.1 完整适配指南

---

## 一、ROCm 7.2.1 核心定位

| 维度 | 说明 |
|------|------|
| **版本** | 7.2.1（生产稳定版）|
| **发布日期** | 2026-03-25 |
| **定位** | 生产环境首选，Ryzen AI Max 系列正式支持 |
| **技术预览版** | ROCm 7.12（不推荐生产使用）|

---

## 二、硬件与系统支持

### 2.1 支持的 Ryzen APU

| APU 系列 | Linux | Windows | 主要框架 |
|----------|-------|---------|-----------|
| **Ryzen AI Max 300 Series** | ✅ 正式支持 | ✅ 正式支持 | PyTorch |
| Select AI 400 Series | ✅ 支持 | ✅ 支持 | PyTorch |
| Select AI 300 Series | ✅ 支持 | ✅ 支持 | PyTorch |

**✅ AMD MAX 395（Strix Halo）明确在支持列表中**

### 2.2 操作系统支持

| OS | 内核要求 | 状态 |
|----|---------|------|
| **Ubuntu 24.04.4** | 6.8 (GA) / **6.17 (HWE)** | ✅ 完全支持 |
| Ubuntu 22.04 | 5.17+ | ✅ 支持 |
| RHEL 10.1 | — | ✅ 仅 Radeon GPU |

**当前系统内核 6.17.0 ✅ 与 HWE 内核完全匹配**

### 2.3 内核驱动状态

系统已有：
- amdgpu 驱动：✅ 已加载（21GB VRAM）
- KFD 设备：✅ /dev/kfd 存在
- HSA Runtime：✅ libhsa-runtime64 5.7.1

**结论：底层硬件已就绪，仅需安装 ROCm 用户空间栈**

---

## 三、安装指南（Ubuntu 24.04）

### 3.1 官方推荐安装步骤

```bash
# 1. 创建密钥目录
sudo mkdir --parents --mode=0755 /etc/apt/keyrings

# 2. 下载并转换 GPG 密钥
wget https://repo.radeon.com/rocm/rocm.gpg.key -O - | \
    gpg --dearmor | sudo tee /etc/apt/keyrings/rocm.gpg > /dev/null

# 3. 添加 ROCm 7.2.1 源（Ubuntu 24.04 = noble）
sudo tee /etc/apt/sources.list.d/rocm.list << 'EOF'
deb [arch=amd64 signed-by=/etc/apt/keyrings/rocm.gpg] https://repo.radeon.com/rocm/apt/7.2.1 noble main
deb [arch=amd64 signed-by=/etc/apt/keyrings/rocm.gpg] https://repo.radeon.com/graphics/7.2.1/ubuntu noble main
EOF

# 4. 设置优先级（防止降级）
sudo tee /etc/apt/preferences.d/rocm-pin-600 << 'EOF'
Package: *
Pin: release o=repo.radeon.com
Pin-Priority: 600
EOF

# 5. 更新包列表
sudo apt update

# 6. 安装 ROCm 完整工具链
sudo apt install rocm
```

### 3.2 ROCm 元包说明

**运行时包（rocm）**：

| 元包 | 说明 | 与本系统关系 |
|------|------|-------------|
| `rocm` | 所有核心包、工具、库 | ⭐ 推荐（一步安装）|
| `rocm-hip-libraries` | HIP 优化库 | Ollama 依赖 |
| `rocm-hip-runtime` | HIP 运行时 | ⭐ 核心依赖 |
| `rocm-ml-libraries` | MIOpen 等机器学习库 | ⭐ PyTorch/vLLM 依赖 |
| `rocm-opencl-runtime` | OpenCL 运行时 | 备选 |
| `amdgpu-lib` | Mesa 3D 图形库 | 桌面用户 |

**开发者包**：

| 元包 | 说明 |
|------|------|
| `rocm-developer-tools` | HIP 调试和性能分析工具 |
| `rocm-hip-sdk` | HIP 应用开发完整 SDK |
| `rocm-ml-sdk` | ML 开发工具链 |

---

## 四、AI 框架支持状态

### 4.1 框架兼容性矩阵

| 框架 | 支持状态 | 适用场景 | 对本系统意义 |
|------|---------|---------|-------------|
| **PyTorch** | ✅ 官方生产支持 | 训练 + 推理 | ⭐ 核心框架 |
| **vLLM** | ✅ 完整支持 | LLM 推理 | ⭐ 推荐推理引擎 |
| **Llama.cpp** | ✅ 支持 | 本地推理 | ✅ Ollama 底层依赖 |
| **TensorFlow** | ✅ 完整支持 | 训练 | 备选 |
| **JAX** | ⚠️ 仅推理 | 研究 | 一般 |
| **ONNX + MIGraphX** | ✅ INT8/INT4 | 优化推理 | 进阶 |

### 4.2 vLLM + ROCm 推理优势

根据官方文档，ROCm 7.2.1 对 vLLM 有**完整支持**，包括：
- PagedAttention 内存管理
- 连续批处理
- FP8 量化支持
- 多 GPU 分布式推理

**对于 MAX 395（128GB 统一内存）**，vLLM 可充分利用：
- 80GB+ 可用显存（64GB DMA + 16GB HBM）
- 多 Cu 配置优化

### 4.3 Ollama 与 ROCm

**当前问题诊断**：

官方文档显示 Llama.cpp 在 ROCm 上被列为"Supported for efficient inference"，但 Ollama 使用的是 Llama.cpp 的**自定义封装**，需要确认：

1. **ROCm 6.1+** 才完整支持 Strix Halo 的异构内存访问
2. **Ollama 0.5+** 对 ROCm 有初步支持
3. **Ollama 的 GPU 卸载机制**：通过 Llama.cpp 的 `n_gpu_layers` 控制

---

## 五、关键安装后配置

### 5.1 用户组权限

```bash
# 将当前用户加入 render 和 video 组（ROCm 需要）
sudo usermod -a -G render,video $USER

# 重新登录后生效，或执行：
newgrp render
newgrp video
```

### 5.2 环境变量

```bash
# ROCm 安装后加入 bashrc
echo 'export ROCM_PATH=/opt/rocm' >> ~/.bashrc
echo 'export PATH=$ROCM_PATH/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=$ROCM_PATH/lib:$LD_LIBRARY_PATH' >> ~/.bashrc

# Ollama 特定配置（使用 ROCm）
echo 'export OLLAMA_HOST=0.0.0.0' >> ~/.bashrc
echo 'export OLLAMA_MODELS=/home/ai/models' >> ~/.bashrc
```

### 5.3 验证安装

```bash
# 1. 检查 ROCm 工具
rocm-smi          # GPU 监控（安装后新增）
rocminfo         # APU/GPU 信息
hipcc --version  # HIP 编译器版本

# 2. 检查 GPU 可见性
rocm-smi --showid --showuse --showmeminfo vram

# 3. 运行 PyTorch ROCm 测试
python3 -c "import torch; print(f'ROCm: {torch.version.hip}, CUDA: {torch.version.cuda}')"

# 4. 检查 vLLM
python3 -c "import vllm; print(vllm.__version__)"
```

---

## 六、安装步骤对现有系统的影响

### 6.1 风险评估

| 风险项 | 级别 | 说明 |
|--------|------|------|
| 内核驱动冲突 | ❌ 无风险 | amdgpu.ko 已加载，ROCm 不修改内核 |
| 系统重启 | ❌ 不需要 | 仅安装用户空间包 |
| 现有服务中断 | ❌ 无 | apt install 不影响运行中进程 |
| Ollama 兼容性 | ⚠️ 需验证 | 建议安装后测试 |
| 图形界面 | ❌ 无影响 | amdgpu-lib 是独立包 |

### 6.2 安装前检查清单

- [ ] 备份重要数据（任何系统变更前的标准操作）
- [ ] 确认 amdgru 驱动版本：`cat /proc/driver/amdgpu/version`
- [ ] 记录当前 Ollama 模型列表：`ollama list`
- [ ] 检查 /opt/ 是否已有 rocm：`ls /opt/rocm* 2>/dev/null`

### 6.3 推荐安装命令（一键）

```bash
# 完全安装 ROCm 7.2.1（包含所有核心组件）
sudo apt install rocm

# 或仅安装运行时（节省空间）
sudo apt install rocm-hip-runtime rocm-ml-libraries

# 验证安装
rocm-smi && echo "ROCm 安装成功"
```

---

## 七、ROCm 7.2.1 vs 旧版本对比

| 特性 | ROCm 5.x（Ubuntu 源）| ROCm 6.x | ROCm 7.2.1 ✅ |
|------|---------------------|----------|---------------|
| Strix Halo 支持 | ❌ 无 | ✅ 部分 | ✅ 完整 |
| Ubuntu 24.04 | ❌ | ⚠️ | ✅ 正式支持 |
| 内核 6.17 | ❌ | ⚠️ | ✅ HWE 验证 |
| vLLM 完整支持 | ❌ | ⚠️ | ✅ |
| PyTorch 官方 | ❌ | ⚠️ | ✅ |
| hipBLASLt FP8 | ❌ | ⚠️ | ✅ 性能优化 |

---

## 八、后续优化建议

### 8.1 Ollama + ROCm 优化参数

安装 ROCm 7.2.1 后，建议在 Ollama 中设置：

```bash
# /etc/systemd/system/ollama.service（创建环境文件）
[Service]
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_GPU_OVERHEAD=536870912"
Environment="ROCM_PATH=/opt/rocm"
```

然后重启 Ollama：
```bash
sudo systemctl restart ollama
```

### 8.2 监控工具

安装 ROCm 后将新增：
- `rocm-smi` — 实时 GPU 监控
- `rocminfo` — 硬件信息报告
- `rocprofiler` — 性能分析

---

## 九、决策参考

### 是否安装 ROCm？

| 考量 | 结论 |
|------|------|
| Ollama 当前是否正常工作？ | ✅ 正常（使用 CPU+amdgpu）|
| 安装 ROCm 能否提升性能？ | ✅ 可能（取决于 Ollama 对 ROCm 的利用程度）|
| 安装风险有多高？ | ⚠️ 低（仅用户空间变更）|
| 不安装是否有问题？ | ❌ 无，amdgpu 驱动已支撑基础运行 |

### 建议

1. **先安装 ROCm 7.2.1**（低风险，高收益）
2. **观察 Ollama 是否自动识别 ROCm**（新版 Ollama 可能自动启用）
3. **如 Ollama 仍无法使用 GPU**，考虑切换到 **vLLM + ROCm** 作为替代推理引擎

---

## 十、参考链接

- ROCm 7.2.1 安装文档：https://rocm.docs.amd.com/projects/install-on-linux/en/docs-7.2.1/
- Ryzen/Radeon 支持：https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/
- vLLM + ROCm：https://rocm.docs.amd.com/en/latest/how-to/llm/vllm.html
- ROCm GitHub：https://github.com/ROCm/ROCm/releases

---

_报告由玄枢生成 — 2026-04-14_
