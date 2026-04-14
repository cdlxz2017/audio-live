#!/usr/bin/env python3
# ============================================================
# report-gen.py - 天雷系统 报告自动生成器
# 功能：读取所有阶段结果，生成HTML格式渗透测试报告
#       含漏洞列表、CVSS评分、修复建议、执行摘要
# ============================================================

import json
import os
import sys
import datetime
import html
from pathlib import Path
from typing import Dict, List, Any, Optional


# ============================================================
# 数据加载
# ============================================================

def load_json_file(filepath: str) -> Optional[Dict]:
    """安全加载JSON文件"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[WARN] 无法加载 {filepath}: {e}")
        return None


def load_text_file(filepath: str) -> Optional[str]:
    """加载文本文件"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None


# ============================================================
# 漏洞分类与评分
# ============================================================

SEVERITY_COLORS = {
    'critical': '#dc3545',
    'high': '#fd7e14',
    'medium': '#ffc107',
    'low': '#17a2b8',
    'info': '#6c757d'
}

SEVERITY_LABELS = {
    'critical': '🔴 严重',
    'high': '🟠 高危',
    'medium': '🟡 中危',
    'low': '🔵 低危',
    'info': '⚪ 信息'
}

# 常见CVE修复建议
FIX_SUGGESTIONS = {
    'MS17-010': '立即安装MS17-010安全补丁，禁用SMBv1协议',
    'Log4j': '升级Log4j至2.17.0+版本，或设置log4j2.formatMsgNoLookups=true',
    'Shellshock': '升级Bash至4.3+版本，修复CVE-2014-6271',
    'CVE-2021-44228': '升级Apache Log4j至2.17.0+，移除JndiLookup类',
    'CVE-2021-41773': '升级Apache HTTP Server至2.4.51+，限制路径遍历',
    'SQL Injection': '使用参数化查询/预编译语句，对用户输入进行严格过滤',
    'XSS': '对用户输出进行HTML编码，设置Content-Security-Policy头部',
    'CSRF': '添加CSRF Token验证，设置SameSite Cookie属性',
    'SSRF': '限制内网访问，使用URL白名单，禁用重定向',
    'Directory Traversal': '验证文件路径，使用白名单限制访问目录',
    'Authentication Bypass': '加强身份验证逻辑，实施多因素认证',
    'Privilege Escalation': '最小权限原则，修复内核漏洞，限制SUID程序',
    'default': '参考对应CVE的官方修复建议，及时更新受影响组件'
}


def get_cvss_severity(cvss_score: float) -> str:
    """根据CVSS评分返回严重等级"""
    if cvss_score >= 9.0:
        return 'critical'
    elif cvss_score >= 7.0:
        return 'high'
    elif cvss_score >= 4.0:
        return 'medium'
    elif cvss_score >= 0.1:
        return 'low'
    else:
        return 'info'


def get_fix_suggestion(vuln_name: str, vuln_desc: str = '') -> str:
    """根据漏洞名称获取修复建议"""
    text = (vuln_name + ' ' + vuln_desc).lower()
    for key, suggestion in FIX_SUGGESTIONS.items():
        if key.lower() in text:
            return suggestion
    return FIX_SUGGESTIONS['default']


# ============================================================
# 报告数据收集
# ============================================================

def collect_report_data(results_dir: str) -> Dict[str, Any]:
    """收集所有阶段的测试结果"""
    data = {
        'project_info': {},
        'recon': {},
        'scan': {},
        'exploit': {},
        'post_exploit': {},
        'vulnerabilities': [],
        'statistics': {}
    }

    # 加载配置
    config = load_json_file(os.path.join(results_dir, 'config_snapshot.json'))
    if config:
        data['project_info'] = config

    # 侦察结果
    recon_assets = load_text_file(os.path.join(results_dir, 'recon', 'final-assets.txt'))
    if recon_assets:
        data['recon']['assets'] = recon_assets.strip().split('\n')

    # 漏洞扫描结果
    vulns = load_json_file(os.path.join(results_dir, 'scan', 'vulns.json'))
    if vulns:
        data['scan'] = vulns
        # 提取漏洞列表
        if 'vulnerabilities' in vulns:
            for v in vulns['vulnerabilities']:
                cvss = v.get('cvss_score', v.get('cvss', 0))
                severity = v.get('severity', get_cvss_severity(float(cvss)))
                data['vulnerabilities'].append({
                    'name': v.get('name', v.get('cve_id', 'Unknown')),
                    'cve_id': v.get('cve_id', v.get('id', '')),
                    'severity': severity,
                    'cvss_score': float(cvss),
                    'target': v.get('host', v.get('target', v.get('url', ''))),
                    'description': v.get('description', ''),
                    'port': v.get('port', ''),
                    'service': v.get('service', ''),
                    'proof': v.get('proof', v.get('evidence', '')),
                    'fix': get_fix_suggestion(v.get('name', ''), v.get('description', ''))
                })

    # 渗透利用结果
    exploits = load_json_file(os.path.join(results_dir, 'exploit', 'results.json'))
    if exploits:
        data['exploit'] = exploits
        if 'exploits' in exploits:
            for exp in exploits['exploits']:
                if exp.get('success'):
                    data['vulnerabilities'].append({
                        'name': f"Exploit: {exp.get('type', 'Unknown')}",
                        'cve_id': exp.get('cve', ''),
                        'severity': 'critical' if exp.get('success') else 'high',
                        'cvss_score': 9.0 if exp.get('success') else 7.0,
                        'target': exp.get('target', ''),
                        'description': f"成功利用: {exp.get('type', '')}",
                        'port': exp.get('port', ''),
                        'service': '',
                        'proof': exp.get('result', ''),
                        'fix': '修复漏洞并验证补丁有效性'
                    })

    # 后渗透结果
    post_exploit = load_json_file(os.path.join(results_dir, 'post-exploit', 'results.json'))
    if post_exploit:
        data['post_exploit'] = post_exploit

    # 统计信息
    data['statistics'] = calculate_statistics(data['vulnerabilities'])

    return data


def calculate_statistics(vulnerabilities: List[Dict]) -> Dict[str, Any]:
    """计算漏洞统计信息"""
    stats = {
        'total': len(vulnerabilities),
        'critical': 0,
        'high': 0,
        'medium': 0,
        'low': 0,
        'info': 0,
        'unique_targets': set(),
        'avg_cvss': 0.0
    }

    total_cvss = 0.0
    for v in vulnerabilities:
        severity = v.get('severity', 'info')
        stats[severity] = stats.get(severity, 0) + 1
        stats['unique_targets'].add(v.get('target', ''))
        total_cvss += v.get('cvss_score', 0)

    if vulnerabilities:
        stats['avg_cvss'] = round(total_cvss / len(vulnerabilities), 1)
    stats['unique_targets'] = len(stats['unique_targets'])

    return stats


# ============================================================
# HTML 报告生成
# ============================================================

def generate_html_report(data: Dict[str, Any]) -> str:
    """生成HTML格式报告"""
    stats = data['statistics']
    vulns = sorted(data['vulnerabilities'], key=lambda x: x.get('cvss_score', 0), reverse=True)

    # 报告头部
    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>渗透测试报告 - {html.escape(data.get('project_info', {}).get('project_name', 'Unknown'))}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; line-height: 1.6; color: #333; background: #f5f7fa; padding: 20px; }}
        .container {{ max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }}
        .header {{ background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; padding: 40px; text-align: center; }}
        .header h1 {{ font-size: 2em; margin-bottom: 10px; }}
        .header .meta {{ opacity: 0.9; font-size: 0.9em; }}
        .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; padding: 30px; background: #f8f9fa; border-bottom: 1px solid #eee; }}
        .stat-card {{ background: white; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .stat-card .number {{ font-size: 2.5em; font-weight: bold; }}
        .stat-card .label {{ color: #666; font-size: 0.9em; margin-top: 5px; }}
        .critical .number {{ color: #dc3545; }}
        .high .number {{ color: #fd7e14; }}
        .medium .number {{ color: #ffc107; }}
        .low .number {{ color: #17a2b8; }}
        .section {{ padding: 30px; border-bottom: 1px solid #eee; }}
        .section h2 {{ color: #1e3c72; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #2a5298; }}
        .vuln-table {{ width: 100%; border-collapse: collapse; margin-top: 15px; }}
        .vuln-table th {{ background: #1e3c72; color: white; padding: 12px 15px; text-align: left; }}
        .vuln-table td {{ padding: 12px 15px; border-bottom: 1px solid #eee; }}
        .vuln-table tr:hover {{ background: #f8f9fa; }}
        .severity-badge {{ display: inline-block; padding: 3px 10px; border-radius: 12px; color: white; font-size: 0.85em; font-weight: bold; }}
        .fix-box {{ background: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin: 10px 0; border-radius: 0 4px 4px 0; }}
        .fix-box h4 {{ color: #2e7d32; margin-bottom: 8px; }}
        .proof-box {{ background: #f5f5f5; border: 1px solid #ddd; padding: 10px; font-family: monospace; font-size: 0.9em; overflow-x: auto; margin: 5px 0; }}
        .footer {{ background: #1e3c72; color: white; padding: 20px; text-align: center; font-size: 0.9em; }}
        @media print {{ body {{ background: white; }} .container {{ box-shadow: none; }} }}
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>⚡ 天雷系统 · 渗透测试报告</h1>
        <div class="meta">
            <p>项目: {html.escape(data.get('project_info', {}).get('project_name', 'N/A'))} | 
               客户: {html.escape(data.get('project_info', {}).get('client_name', 'N/A'))} | 
               测试人员: {html.escape(data.get('project_info', {}).get('tester_name', 'N/A'))}</p>
            <p>报告生成时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        </div>
    </div>

    <div class="summary">
        <div class="stat-card">
            <div class="number">{stats['total']}</div>
            <div class="label">漏洞总数</div>
        </div>
        <div class="stat-card critical">
            <div class="number">{stats['critical']}</div>
            <div class="label">严重</div>
        </div>
        <div class="stat-card high">
            <div class="number">{stats['high']}</div>
            <div class="label">高危</div>
        </div>
        <div class="stat-card medium">
            <div class="number">{stats['medium']}</div>
            <div class="label">中危</div>
        </div>
        <div class="stat-card low">
            <div class="number">{stats['low']}</div>
            <div class="label">低危</div>
        </div>
        <div class="stat-card">
            <div class="number">{stats['avg_cvss']}</div>
            <div class="label">平均 CVSS</div>
        </div>
    </div>
"""

    # 执行摘要
    html_content += """
    <div class="section">
        <h2>📋 执行摘要</h2>
        <p>本次渗透测试共发现 <strong>{total}</strong> 个安全问题，其中严重漏洞 <strong>{critical}</strong> 个，高危漏洞 <strong>{high}</strong> 个。
        测试覆盖 {targets} 个目标主机/服务。平均 CVSS 评分为 <strong>{avg_cvss}</strong>。</p>
        <p style="margin-top: 15px;"><strong>建议优先级：</strong></p>
        <ul>
""".format(
        total=stats['total'],
        critical=stats['critical'],
        high=stats['high'],
        targets=stats['unique_targets'],
        avg_cvss=stats['avg_cvss']
    )

    if stats['critical'] > 0:
        html_content += "<li><span style='color:#dc3545'>🔴 立即修复所有严重漏洞，这些漏洞可能被直接利用获取系统权限</span></li>"
    if stats['high'] > 0:
        html_content += "<li><span style='color:#fd7e14'>🟠 一周内修复高危漏洞，防止攻击者利用进行横向移动</span></li>"
    if stats['medium'] > 0:
        html_content += "<li><span style='color:#ffc107'>🟡 一个月内完成中危漏洞修复</span></li>"
    if stats['low'] > 0:
        html_content += "<li><span style='color:#17a2b8'>🔵 按计划修复低危漏洞和信息泄露</span></li>"

    html_content += """
        </ul>
    </div>
"""

    # 漏洞详情
    if vulns:
        html_content += """
    <div class="section">
        <h2>🔍 漏洞详情</h2>
        <table class="vuln-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>严重等级</th>
                    <th>CVSS</th>
                    <th>漏洞名称</th>
                    <th>目标</th>
                    <th>端口/服务</th>
                </tr>
            </thead>
            <tbody>
"""
        for i, v in enumerate(vulns, 1):
            severity = v.get('severity', 'info')
            color = SEVERITY_COLORS.get(severity, '#666')
            label = SEVERITY_LABELS.get(severity, '未知')

            html_content += f"""
                <tr>
                    <td>{i}</td>
                    <td><span class="severity-badge" style="background:{color}">{label}</span></td>
                    <td>{v.get('cvss_score', 'N/A')}</td>
                    <td>{html.escape(v.get('name', 'Unknown'))}</td>
                    <td>{html.escape(str(v.get('target', '')))}</td>
                    <td>{v.get('port', '')}/{v.get('service', '')}</td>
                </tr>
"""

        html_content += """
            </tbody>
        </table>
    </div>
"""

        # 每个漏洞的详细信息和修复建议
        html_content += """
    <div class="section">
        <h2>🛠️ 修复建议</h2>
"""
        for i, v in enumerate(vulns, 1):
            severity = v.get('severity', 'info')
            color = SEVERITY_COLORS.get(severity, '#666')

            html_content += f"""
        <div style="margin-bottom: 25px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
            <h3 style="color: {color};">#{i} {html.escape(v.get('name', 'Unknown'))}
                <span class="severity-badge" style="background:{color}; font-size: 0.7em; vertical-align: middle;">
                    {SEVERITY_LABELS.get(severity, '未知')} (CVSS: {v.get('cvss_score', 'N/A')})
                </span>
            </h3>
            <p><strong>目标:</strong> {html.escape(str(v.get('target', '')))}</p>
            <p><strong>端口/服务:</strong> {v.get('port', '')}/{v.get('service', '')}</p>
            <p><strong>描述:</strong> {html.escape(v.get('description', '无'))}</p>
"""

            if v.get('proof'):
                html_content += f"""
            <p><strong>验证证据:</strong></p>
            <div class="proof-box">{html.escape(str(v.get('proof', ''))[:500])}</div>
"""

            html_content += f"""
            <div class="fix-box">
                <h4>💡 修复建议</h4>
                <p>{html.escape(v.get('fix', FIX_SUGGESTIONS['default']))}</p>
            </div>
        </div>
"""

        html_content += """
    </div>
"""

    else:
        html_content += """
    <div class="section">
        <h2>🔍 漏洞详情</h2>
        <p>本次测试未发现已知漏洞。建议保持定期安全扫描和补丁更新。</p>
    </div>
"""

    # 侦察结果
    if data.get('recon', {}).get('assets'):
        assets = data['recon']['assets']
        html_content += f"""
    <div class="section">
        <h2>🌐 侦察资产清单</h2>
        <p>共发现 {len(assets)} 个资产目标：</p>
        <div class="proof-box">
            {'<br>'.join(html.escape(a) for a in assets[:50])}
            {'<br>...' if len(assets) > 50 else ''}
        </div>
    </div>
"""

    # 页脚
    html_content += f"""
    <div class="footer">
        <p>本报告由天雷系统自动生成 | 仅供授权安全测试使用 | ⚡ 雷霆万钧，无所不至</p>
        <p>生成时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
    </div>
</div>
</body>
</html>
"""

    return html_content


# ============================================================
# 主函数
# ============================================================

def main():
    results_dir = sys.argv[1] if len(sys.argv) > 1 else '.'

    print(f"[*] ⚡ 天雷系统 - 报告生成器")
    print(f"[*] 结果目录: {results_dir}")

    # 收集数据
    print("[*] 收集测试结果数据...")
    data = collect_report_data(results_dir)

    # 生成报告
    print(f"[*] 发现 {data['statistics']['total']} 个漏洞，生成报告...")
    html_report = generate_html_report(data)

    # 保存报告
    report_dir = os.path.join(results_dir, 'report')
    os.makedirs(report_dir, exist_ok=True)

    report_file = os.path.join(report_dir, 'pentest-report.html')
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(html_report)

    print(f"[+] 报告已生成: {report_file}")

    # 同时生成 Markdown 版本
    md_report = generate_markdown_report(data)
    md_file = os.path.join(report_dir, 'pentest-report.md')
    with open(md_file, 'w', encoding='utf-8') as f:
        f.write(md_report)

    print(f"[+] Markdown报告: {md_file}")

    # 输出摘要
    stats = data['statistics']
    print(f"\n[*] 统计摘要:")
    print(f"    总漏洞数: {stats['total']}")
    print(f"    严重: {stats['critical']} | 高危: {stats['high']} | 中危: {stats['medium']} | 低危: {stats['low']}")
    print(f"    平均CVSS: {stats['avg_cvss']}")
    print(f"    目标数量: {stats['unique_targets']}")


def generate_markdown_report(data: Dict[str, Any]) -> str:
    """生成Markdown格式报告（备用）"""
    stats = data['statistics']
    vulns = sorted(data['vulnerabilities'], key=lambda x: x.get('cvss_score', 0), reverse=True)

    md = f"""# 渗透测试报告

## 项目信息
- **项目名称**: {data.get('project_info', {}).get('project_name', 'N/A')}
- **客户**: {data.get('project_info', {}).get('client_name', 'N/A')}
- **测试人员**: {data.get('project_info', {}).get('tester_name', 'N/A')}
- **生成时间**: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 执行摘要

| 指标 | 值 |
|------|-----|
| 漏洞总数 | {stats['total']} |
| 严重 | {stats['critical']} |
| 高危 | {stats['high']} |
| 中危 | {stats['medium']} |
| 低危 | {stats['low']} |
| 平均CVSS | {stats['avg_cvss']} |
| 目标数量 | {stats['unique_targets']} |

## 漏洞详情

| # | 严重等级 | CVSS | 漏洞名称 | 目标 | 端口/服务 |
|---|---------|------|---------|------|----------|
"""

    for i, v in enumerate(vulns, 1):
        md += f"| {i} | {v.get('severity', 'info')} | {v.get('cvss_score', 'N/A')} | {v.get('name', 'Unknown')} | {v.get('target', '')} | {v.get('port', '')}/{v.get('service', '')} |\n"

    md += "\n## 修复建议\n\n"
    for i, v in enumerate(vulns, 1):
        md += f"### #{i} {v.get('name', 'Unknown')} ({v.get('severity', 'info')}, CVSS: {v.get('cvss_score', 'N/A')})\n\n"
        md += f"- **目标**: {v.get('target', '')}\n"
        md += f"- **描述**: {v.get('description', '')}\n"
        md += f"- **修复**: {v.get('fix', '')}\n\n"

    md += "\n---\n*本报告由天雷系统自动生成 | ⚡ 雷霆万钧，无所不至*\n"

    return md


if __name__ == '__main__':
    main()
