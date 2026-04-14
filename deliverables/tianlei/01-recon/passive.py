#!/usr/bin/env python3
# ============================================================
# passive.py - 被动信息收集
# 功能：子域名枚举、DNS记录查询、WHOIS、搜索引擎信息收集
# 依赖工具：subfinder, amass, dnsrecon, whois, dig
# ============================================================

import subprocess
import sys
import os
import json
import shutil
from datetime import datetime


class PassiveRecon:
    """被动信息收集类"""

    def __init__(self, domains: list, output_dir: str):
        """
        Args:
            domains: 目标域名列表
            output_dir: 结果输出目录
        """
        self.domains = domains
        self.output_dir = output_dir
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "domains": domains,
            "subdomains": [],
            "dns_records": [],
            "whois_info": [],
        }
        os.makedirs(output_dir, exist_ok=True)

    def _tool_exists(self, tool: str) -> bool:
        """检查工具是否安装"""
        return shutil.which(tool) is not None

    def _run_cmd(self, cmd: list, desc: str, timeout: int = 300) -> str:
        """安全执行命令"""
        print(f"  [*] {desc}...", file=sys.stderr)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            if result.returncode != 0 and result.stderr:
                print(f"  [!] 警告: {result.stderr[:200]}", file=sys.stderr)
            return result.stdout
        except subprocess.TimeoutExpired:
            print(f"  [!] 超时: {desc}", file=sys.stderr)
            return ""
        except FileNotFoundError:
            print(f"  [!] 命令不存在: {cmd[0]}", file=sys.stderr)
            return ""

    def run_subfinder(self) -> list:
        """使用subfinder进行子域名枚举"""
        if not self._tool_exists("subfinder"):
            print("  [SKIP] subfinder 未安装 (go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest)", file=sys.stderr)
            return []

        all_subs = []
        for domain in self.domains:
            output_file = os.path.join(self.output_dir, f"subfinder_{domain}.txt")
            output = self._run_cmd(
                ["subfinder", "-d", domain, "-silent", "-all"],
                f"subfinder 枚举 {domain}",
            )
            subs = [line.strip() for line in output.splitlines() if line.strip()]
            all_subs.extend(subs)
            with open(output_file, "w") as f:
                f.write("\n".join(subs))
            print(f"  [+] subfinder 发现 {len(subs)} 个子域名 ({domain})", file=sys.stderr)

        return all_subs

    def run_amass(self) -> list:
        """使用amass进行子域名枚举"""
        if not self._tool_exists("amass"):
            print("  [SKIP] amass 未安装 (go install -v github.com/owasp-amass/amass/v4/...@master)", file=sys.stderr)
            return []

        all_subs = []
        for domain in self.domains:
            output_file = os.path.join(self.output_dir, f"amass_{domain}.txt")
            output = self._run_cmd(
                ["amass", "enum", "-passive", "-d", domain],
                f"amass 枚举 {domain}",
                timeout=600,
            )
            subs = [line.strip() for line in output.splitlines() if line.strip()]
            all_subs.extend(subs)
            with open(output_file, "w") as f:
                f.write("\n".join(subs))
            print(f"  [+] amass 发现 {len(subs)} 个子域名 ({domain})", file=sys.stderr)

        return all_subs

    def run_dnsrecon(self) -> list:
        """使用dnsrecon进行DNS记录查询"""
        if not self._tool_exists("dnsrecon"):
            print("  [SKIP] dnsrecon 未安装 (pip install dnsrecon)", file=sys.stderr)
            return []

        all_records = []
        for domain in self.domains:
            output_file = os.path.join(self.output_dir, f"dnsrecon_{domain}.json")
            output = self._run_cmd(
                ["dnsrecon", "-d", domain, "-t", "std,brt", "-j", output_file],
                f"dnsrecon 查询 {domain}",
            )
            if os.path.isfile(output_file):
                try:
                    with open(output_file) as f:
                        records = json.load(f)
                    all_records.extend(records)
                    print(f"  [+] dnsrecon 发现 {len(records)} 条记录 ({domain})", file=sys.stderr)
                except json.JSONDecodeError:
                    print(f"  [!] dnsrecon 输出解析失败", file=sys.stderr)

        return all_records

    def run_dig(self) -> list:
        """使用dig查询DNS记录"""
        if not self._tool_exists("dig"):
            print("  [SKIP] dig 未安装 (apt install dnsutils)", file=sys.stderr)
            return []

        records = []
        record_types = ["A", "AAAA", "MX", "NS", "TXT", "SOA", "CNAME", "SRV"]

        for domain in self.domains:
            for rtype in record_types:
                output = self._run_cmd(
                    ["dig", "+short", domain, rtype],
                    f"dig {rtype} {domain}",
                    timeout=30,
                )
                for line in output.splitlines():
                    line = line.strip()
                    if line:
                        records.append(
                            {"domain": domain, "type": rtype, "value": line}
                        )

        output_file = os.path.join(self.output_dir, "dig_records.json")
        with open(output_file, "w") as f:
            json.dump(records, f, indent=2, ensure_ascii=False)
        print(f"  [+] dig 发现 {len(records)} 条DNS记录", file=sys.stderr)
        return records

    def run_whois(self) -> list:
        """WHOIS查询"""
        if not self._tool_exists("whois"):
            print("  [SKIP] whois 未安装 (apt install whois)", file=sys.stderr)
            return []

        whois_data = []
        for domain in self.domains:
            output = self._run_cmd(
                ["whois", domain],
                f"whois 查询 {domain}",
                timeout=60,
            )
            if output:
                info = {"domain": domain, "raw": output}
                # 提取关键字段
                for line in output.splitlines():
                    line = line.strip()
                    if ":" in line:
                        key, _, val = line.partition(":")
                        key = key.strip().lower()
                        val = val.strip()
                        if key in ("registrar", "creation date", "expiry date", "name server", "registrant organization"):
                            info[key.replace(" ", "_")] = val
                whois_data.append(info)

            output_file = os.path.join(self.output_dir, f"whois_{domain}.txt")
            with open(output_file, "w") as f:
                f.write(output)

        return whois_data

    def run_all(self) -> dict:
        """执行所有被动收集"""
        print("\n[=== 被动信息收集 ===]", file=sys.stderr)

        # 子域名枚举
        print("\n[1/4] 子域名枚举", file=sys.stderr)
        subs_subfinder = self.run_subfinder()
        subs_amass = self.run_amass()

        # 合并去重
        all_subs = sorted(set(subs_subfinder + subs_amass))
        self.results["subdomains"] = all_subs
        print(f"\n  [+] 子域名合计（去重后）: {len(all_subs)}", file=sys.stderr)

        # 保存合并结果
        subs_file = os.path.join(self.output_dir, "all_subdomains.txt")
        with open(subs_file, "w") as f:
            f.write("\n".join(all_subs))

        # DNS记录
        print("\n[2/4] DNS记录查询", file=sys.stderr)
        dns_records = self.run_dnsrecon()
        dig_records = self.run_dig()
        self.results["dns_records"] = dns_records + dig_records

        # WHOIS
        print("\n[3/4] WHOIS查询", file=sys.stderr)
        self.results["whois_info"] = self.run_whois()

        # 保存汇总
        print("\n[4/4] 保存汇总结果", file=sys.stderr)
        summary_file = os.path.join(self.output_dir, "passive_summary.json")
        # 移除whois raw字段（太大）
        export_results = json.loads(json.dumps(self.results))
        for w in export_results.get("whois_info", []):
            w.pop("raw", None)
        with open(summary_file, "w") as f:
            json.dump(export_results, f, indent=2, ensure_ascii=False)

        print(f"\n[✓] 被动收集完成，结果保存至: {self.output_dir}", file=sys.stderr)
        return self.results


def main():
    """主入口"""
    if len(sys.argv) < 3:
        print("用法: passive.py <域名(逗号分隔)> <输出目录>", file=sys.stderr)
        print("示例: passive.py example.com,sub.example.com ./results/recon/passive", file=sys.stderr)
        sys.exit(1)

    domains = [d.strip() for d in sys.argv[1].split(",") if d.strip()]
    output_dir = sys.argv[2]

    recon = PassiveRecon(domains, output_dir)
    results = recon.run_all()

    # 输出子域名到stdout供管道使用
    for sub in results.get("subdomains", []):
        print(sub)


if __name__ == "__main__":
    main()
